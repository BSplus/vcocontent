import { useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Clock3, Mail, Send } from "lucide-react";
import { Link } from "wouter";
import Footer from "@/components/footer";
import LegalLinks from "@/components/legal-links";
import MainNavigation from "@/components/main-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supportSchema, type SupportInput } from "@shared/support";

type Field = "name" | "email" | "subject" | "message";
type SupportStatus = "accepted" | "validation" | "unavailable" | "rate_limited" | "rejected" | "uncertain";
type ResponseBody = {
  status: SupportStatus;
  errors?: Partial<Record<Field, string>>;
  error?: string;
};
type ContactDraft = Pick<SupportInput, Field> & { website: string };
type FieldErrors = Partial<Record<Field, string>>;

const initialDraft: ContactDraft = { name: "", email: "", subject: "", message: "", website: "" };
const fieldOrder: Field[] = ["name", "email", "subject", "message"];
const fieldLabel: Record<Field, string> = {
  name: "Name",
  email: "Email address",
  subject: "Subject",
  message: "Message",
};

const inputClasses =
  "mt-2 h-12 rounded-none border-border bg-background/70 px-4 text-base placeholder:text-muted-foreground/70 focus-visible:ring-primary";

export default function SupportPage() {
  const [draft, setDraft] = useState<ContactDraft>(initialDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<ResponseBody | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [locked, setLocked] = useState(false);
  const submissionInFlight = useRef(false);
  const permanentlyLocked = useRef(false);
  const fieldRefs = useRef<Record<Field, HTMLInputElement | HTMLTextAreaElement | null>>({
    name: null,
    email: null,
    subject: null,
    message: null,
  });

  const update = (field: keyof ContactDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field !== "website" && errors[field as Field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
    if (status && !locked) setStatus(null);
  };

  const focusFirstInvalid = (nextErrors: FieldErrors) => {
    const firstInvalid = fieldOrder.find((field) => nextErrors[field]);
    if (firstInvalid) requestAnimationFrame(() => fieldRefs.current[firstInvalid]?.focus());
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submissionInFlight.current || permanentlyLocked.current || locked) return;

    const requestId = crypto.randomUUID();
    const parsed = supportSchema.safeParse({ ...draft, requestId });
    if (!parsed.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (fieldOrder.includes(field as Field) && !nextErrors[field as Field]) {
          nextErrors[field as Field] = issue.message;
        }
      }
      setErrors(nextErrors);
      setStatus({ status: "validation", error: "Please correct the highlighted fields and try again." });
      setRetryAvailable(true);
      focusFirstInvalid(nextErrors);
      return;
    }

    submissionInFlight.current = true;
    setBusy(true);
    setErrors({});
    setStatus(null);
    setRetryAvailable(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch("/api/support", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error("The response could not be read.");
      }

      if (!body || typeof body !== "object" || !("status" in body)) {
        throw new Error("The response was not recognised.");
      }
      const received = body as Partial<ResponseBody>;
      const allowedStatuses: SupportStatus[] = [
        "accepted",
        "validation",
        "unavailable",
        "rate_limited",
        "rejected",
        "uncertain",
      ];
      if (typeof received.status !== "string" || !allowedStatuses.includes(received.status as SupportStatus)) {
        throw new Error("The response was not recognised.");
      }
      if (
        (received.errors !== undefined &&
          (!received.errors ||
            typeof received.errors !== "object" ||
            Array.isArray(received.errors) ||
            Object.values(received.errors).some((value) => typeof value !== "string"))) ||
        (received.error !== undefined && typeof received.error !== "string")
      ) {
        throw new Error("The response was not recognised.");
      }

      const responseStatus = received.status as SupportStatus;
      if (responseStatus === "accepted" && !response.ok) throw new Error("Acceptance could not be confirmed.");
      const responseErrors: FieldErrors = {};
      if (received.errors && typeof received.errors === "object") {
        for (const field of fieldOrder) {
          const message = received.errors[field];
          if (typeof message === "string") responseErrors[field] = message;
        }
      }
      const result: ResponseBody = {
        status: responseStatus,
        errors: responseErrors,
        error: typeof received.error === "string" ? received.error : undefined,
      };
      setStatus(result);

      if (responseStatus === "accepted") {
        permanentlyLocked.current = true;
        setLocked(true);
        setRetryAvailable(false);
      } else if (responseStatus === "uncertain") {
        permanentlyLocked.current = true;
        setLocked(true);
        setRetryAvailable(false);
      } else {
        setRetryAvailable(true);
        setErrors(responseErrors);
        focusFirstInvalid(responseErrors);
      }
    } catch {
      permanentlyLocked.current = true;
      setStatus({
        status: "uncertain",
        error: "We could not confirm the result. Your message may have been sent.",
      });
      setLocked(true);
      setRetryAvailable(false);
    } finally {
      window.clearTimeout(timeout);
      submissionInFlight.current = false;
      setBusy(false);
    }
  };

  const fieldMessage = (field: Field) => errors[field];
  const isUncertain = status?.status === "uncertain";
  const isAccepted = status?.status === "accepted";
  const statusCopy = () => {
    if (!status) return "";
    if (status.status === "accepted") {
      return "Your message was accepted by our mail provider. This confirms acceptance for processing, not delivery to the recipient’s inbox.";
    }
    if (status.status === "uncertain") {
      return `${status.error ?? "We could not confirm whether your message was accepted."} Please check with VCO before sending again.`;
    }
    if (status.status === "validation") {
      return status.error ?? "Please check the fields below and try again.";
    }
    if (status.status === "rate_limited") {
      return status.error ?? "Too many requests were received. Please wait a little before trying again.";
    }
    if (status.status === "unavailable") {
      return status.error ?? "The contact service is temporarily unavailable. You can try again shortly.";
    }
    return status.error ?? "Your message was not accepted. Please review the details and try again.";
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <MainNavigation />
      <main className="mx-auto max-w-[1492px] px-5 pb-16 pt-9 sm:px-8 lg:px-9 lg:pt-14">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-sm font-semibold uppercase tracking-[0.08em] text-primary underline underline-offset-4"
        >
          Back to the gallery
        </Link>

        <section className="mt-8 grid gap-10 border-y border-border py-8 sm:py-12 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.82fr)] lg:gap-16 lg:py-16">
          <div className="relative flex flex-col justify-between overflow-hidden">
            <div>
              <p className="vco-kicker">VCO Media Database / Contact</p>
              <h1 className="mt-6 max-w-3xl text-6xl leading-[0.85] sm:text-8xl lg:text-[8.5rem]">
                In the<br />
                <span className="text-primary">loop.</span>
              </h1>
              <p className="mt-8 max-w-xl text-lg leading-relaxed text-foreground/75 sm:text-xl">
                Questions about the gallery, a photograph, or your account? Send a note to the VCO team.
              </p>
            </div>
            <div className="mt-14 max-w-xl border-l-2 border-primary pl-5">
              <p className="text-sm font-bold uppercase tracking-[0.12em] text-foreground">A direct line to VCO</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Include enough context for us to understand your enquiry. Please don’t send passwords or sensitive information.
              </p>
            </div>
          </div>

          <div className="relative border border-border bg-card/70">
            <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-7">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center border border-primary/40 text-primary">
                  <Mail aria-hidden="true" className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-foreground">Contact form</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Replies are handled by the VCO team</p>
                </div>
              </div>
              <span className="hidden items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-accent sm:flex">
                <Clock3 aria-hidden="true" className="h-3.5 w-3.5" /> Secure enquiry
              </span>
            </div>

            <form onSubmit={submit} noValidate className="space-y-5 p-5 sm:p-7">
              <div
                aria-hidden="true"
                className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
              >
                <Label htmlFor="website">Leave this field blank</Label>
                <Input
                  id="website"
                  name="website"
                  value={draft.website}
                  onChange={(event) => update("website", event.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  maxLength={200}
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                {(["name", "email"] as const).map((field) => (
                  <div key={field}>
                    <Label htmlFor={field} className="text-xs font-bold uppercase tracking-[0.12em] text-foreground">
                      {fieldLabel[field]} <span className="text-primary" aria-hidden="true">*</span>
                    </Label>
                    <Input
                      ref={(node) => { fieldRefs.current[field] = node; }}
                      id={field}
                      readOnly={busy || locked}
                      name={field}
                      type={field === "email" ? "email" : "text"}
                      autoComplete={field === "name" ? "name" : "email"}
                      required
                      maxLength={field === "name" ? 100 : 254}
                      value={draft[field]}
                      onChange={(event) => update(field, event.target.value)}
                      aria-invalid={Boolean(fieldMessage(field))}
                      aria-describedby={fieldMessage(field) ? `${field}-error` : undefined}
                      className={`${inputClasses}${fieldMessage(field) ? " border-destructive" : ""}`}
                    />
                    {fieldMessage(field) && <p id={`${field}-error`} className="mt-1.5 text-sm text-destructive" role="alert">{fieldMessage(field)}</p>}
                  </div>
                ))}
              </div>

              <div>
                <Label htmlFor="subject" className="text-xs font-bold uppercase tracking-[0.12em] text-foreground">
                  Subject <span className="text-primary" aria-hidden="true">*</span>
                </Label>
                <Input
                  ref={(node) => { fieldRefs.current.subject = node; }}
                  id="subject"
                  readOnly={busy || locked}
                  name="subject"
                  required
                  maxLength={150}
                  value={draft.subject}
                  onChange={(event) => update("subject", event.target.value)}
                  aria-invalid={Boolean(fieldMessage("subject"))}
                  aria-describedby={fieldMessage("subject") ? "subject-error" : undefined}
                  className={`${inputClasses}${fieldMessage("subject") ? " border-destructive" : ""}`}
                />
                {fieldMessage("subject") && <p id="subject-error" className="mt-1.5 text-sm text-destructive" role="alert">{fieldMessage("subject")}</p>}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="message" className="text-xs font-bold uppercase tracking-[0.12em] text-foreground">
                    Message <span className="text-primary" aria-hidden="true">*</span>
                  </Label>
                  <span className="text-xs tabular-nums text-muted-foreground">{draft.message.length} / 5000</span>
                </div>
                <Textarea
                  ref={(node) => { fieldRefs.current.message = node; }}
                  id="message"
                  readOnly={busy || locked}
                  name="message"
                  required
                  maxLength={5000}
                  rows={6}
                  value={draft.message}
                  onChange={(event) => update("message", event.target.value)}
                  aria-invalid={Boolean(fieldMessage("message"))}
                  aria-describedby={fieldMessage("message") ? "message-error" : undefined}
                  className={`mt-2 min-h-40 resize-y rounded-none border-border bg-background/70 px-4 py-3 text-base placeholder:text-muted-foreground/70 focus-visible:ring-primary${fieldMessage("message") ? " border-destructive" : ""}`}
                />
                {fieldMessage("message") && <p id="message-error" className="mt-1.5 text-sm text-destructive" role="alert">{fieldMessage("message")}</p>}
              </div>

              <div aria-live="polite" aria-atomic="true">
                {status && (
                  <div
                    className={`flex gap-3 border p-4 text-sm leading-relaxed ${
                      isAccepted
                        ? "border-accent/50 bg-accent/10 text-foreground"
                        : isUncertain
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-destructive/50 bg-destructive/10 text-foreground"
                    }`}
                    role="status"
                  >
                    <span className="mt-0.5 shrink-0">
                      {isAccepted ? <Check aria-hidden="true" className="h-4 w-4 text-accent" /> : <Mail aria-hidden="true" className="h-4 w-4 text-primary" />}
                    </span>
                    <p>{statusCopy()}</p>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                  Your name, email, subject and message are processed by VCO and Resend to respond. See our{" "}
                  <Link href="/privacy-policy" className="text-primary underline underline-offset-2">Privacy Policy</Link>.
                </p>
                <Button
                  type="submit"
                  disabled={busy || locked}
                  className="vco-button h-12 shrink-0 px-6"
                  aria-busy={busy}
                >
                  {busy ? "Sending…" : isAccepted ? "Message accepted" : locked ? "Check with VCO" : retryAvailable ? "Try again" : "Send message"}
                  {!busy && !locked && !isAccepted && <Send aria-hidden="true" className="h-4 w-4" />}
                </Button>
              </div>
            </form>
          </div>
        </section>

        <section className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="vco-kicker">VCO Media Database</p>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              For privacy enquiries, you can also contact our privacy team directly. Your message is for VCO; no automatic visitor email is sent.
            </p>
          </div>
          <a
            href="mailto:dataprotection@vco-esports.com"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary underline underline-offset-4"
          >
            Privacy enquiries <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
          </a>
        </section>

        <div className="mt-10 border-t border-border pt-5">
          <LegalLinks />
        </div>
      </main>
      <Footer />
    </div>
  );
}
