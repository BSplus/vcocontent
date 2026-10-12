import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  LogIn,
  MailCheck,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type EmailVerificationStatusProps = {
  status: "confirming" | "success" | "invalid" | "unavailable";
  sessionStatus: "loading" | "ready" | "error";
  username?: string;
  currentEmailVerified?: boolean;
  showLogin: boolean;
  onSignIn: () => void;
  onContinue: () => void;
  onRefreshSession: () => void;
};

export default function EmailVerificationStatus({
  status,
  sessionStatus,
  username,
  currentEmailVerified,
  showLogin,
  onSignIn,
  onContinue,
  onRefreshSession,
}: EmailVerificationStatusProps) {
  const isSuccess = status === "success";
  const isConfirming = status === "confirming";
  const isError = status === "invalid" || status === "unavailable";
  const Icon = isSuccess
    ? CheckCircle2
    : isConfirming
      ? LoaderCircle
      : AlertCircle;

  return (
    <section
      data-testid="verification-status"
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className="w-full border border-border bg-background p-5 shadow-sm sm:p-7"
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        <div
          className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center ${
            isSuccess
              ? "bg-primary/10 text-primary"
              : isError
                ? "bg-destructive/10 text-destructive"
                : "bg-secondary text-secondary-foreground"
          }`}
          aria-hidden="true"
        >
          <Icon
            className={`h-5 w-5 ${isConfirming ? "animate-spin" : ""}`}
            strokeWidth={2}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="vco-kicker mb-2">
            {isSuccess ? "Account verification" : "Email verification"}
          </p>
          <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">
            {isSuccess
              ? "Email confirmed"
              : isConfirming
                ? "Confirming your email"
                : status === "invalid"
                  ? "This link can’t be used"
                  : "We couldn’t confirm this link"}
          </h2>

          {isSuccess && (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                The email address linked to this confirmation link has been
                verified.
              </p>

              {sessionStatus === "loading" && (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Checking your current session…</span>
                </div>
              )}

              {sessionStatus === "ready" &&
                (username ? (
                  <>
                    <p className="mt-3 text-sm leading-relaxed">
                      You are signed in as{" "}
                      <span className="font-semibold text-foreground">
                        {username}
                      </span>
                      . Your current session has not changed.
                    </p>
                    <Button
                      type="button"
                      className="mt-5 h-auto min-h-11 whitespace-normal"
                      onClick={onContinue}
                    >
                      Continue
                      <ArrowRight aria-hidden="true" />
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      Verification does not sign you in. Sign in to continue to
                      your account.
                    </p>
                    {!showLogin && (
                      <Button
                        type="button"
                        className="mt-5 h-auto min-h-11 whitespace-normal"
                        onClick={onSignIn}
                      >
                        <LogIn aria-hidden="true" />
                        Sign in
                      </Button>
                    )}
                  </>
                ))}

              {sessionStatus === "error" && (
                <div className="mt-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Email confirmation succeeded, but we couldn’t check your
                    current session.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4 h-auto min-h-11 whitespace-normal"
                    onClick={onRefreshSession}
                  >
                    <RefreshCw aria-hidden="true" />
                    Retry session check
                  </Button>
                </div>
              )}
            </>
          )}

          {isConfirming && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Please wait while we check your confirmation link.
            </p>
          )}

          {status === "invalid" && (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                This link is invalid, expired, or has already been used. Sign
                in and check your email status in Account settings. If confirmation
                is still pending, request a new link from Creator access.
              </p>
            </>
          )}

          {status === "unavailable" && (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                We couldn’t confirm the link. It may have completed if the
                response was lost. Check Account email status, or open the
                original email link again.
              </p>
            </>
          )}
          {isError && (
            <div className="mt-4">
              {sessionStatus === "loading" ? (
                <p className="text-sm text-muted-foreground">Checking your current session…</p>
              ) : sessionStatus === "error" ? (
                <>
                  <p className="text-sm text-muted-foreground">We couldn’t check your current session.</p>
                  <Button type="button" variant="outline" className="mt-4 h-auto min-h-11 whitespace-normal" onClick={onRefreshSession}>
                    <RefreshCw aria-hidden="true" /> Retry session check
                  </Button>
                </>
              ) : username ? (
                <>
                  <p className="text-sm">You are still signed in as {username}.</p>
                  <Button asChild className="mt-4 h-auto min-h-11 whitespace-normal">
                    <a href="/account?tab=settings"><MailCheck aria-hidden="true" /> Check Account email status</a>
                  </Button>
                  {!currentEmailVerified && (
                    <Button asChild variant="outline" className="mt-3 h-auto min-h-11 whitespace-normal">
                      <a href="/creator/apply">Request a new link for this account</a>
                    </Button>
                  )}
                </>
              ) : !showLogin ? (
                <Button type="button" className="h-auto min-h-11 whitespace-normal" onClick={onSignIn}>
                  <LogIn aria-hidden="true" /> Sign in to check Account
                </Button>
              ) : null}
            </div>
          )}
          {isError && sessionStatus === "ready" && !username && (
            <p className="mt-3 text-sm text-muted-foreground">
              After signing in, open <a className="underline" href="/creator/apply">Creator access</a> to
              request a new verification email if needed.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
