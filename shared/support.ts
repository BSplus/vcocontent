import { z } from "zod";

const headerText = (max: number, label: string) => z.string().trim().min(1, `${label} is required.`)
  .max(max, `${label} must be ${max} characters or fewer.`)
  .regex(/^[^\u0000-\u001f\u007f]+$/, `${label} must not contain line breaks or control characters.`);
export const supportSchema = z.object({
  name: headerText(100, "Name"),
  email: headerText(254, "Email address").email("Enter a valid email address."),
  subject: headerText(150, "Subject"),
  message: z.string().trim().min(1, "Message is required.").max(5000, "Message must be 5000 characters or fewer.")
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, "Message contains unsupported control characters."),
  website: z.string().max(200).default(""),
  requestId: z.string().uuid(),
}).strict();
export type SupportInput = z.infer<typeof supportSchema>;
