import nodemailer from 'nodemailer';

/**
 * Email, of which there is now exactly one kind: the paid-order invoice.
 *
 * Everything else this file used to do — the signup verification code, the
 * change-email code, the password-reset link — is gone, because email stopped
 * being an identity factor. The phone is the contact of record, proven by SMS;
 * email is optional and unverified, so nothing can be gated on it. A reset link
 * sent to an address that most accounts do not have is not a reset flow.
 *
 * The practical consequence for callers: `email` here is always `string`, but
 * the column it comes from is `String?`. Check before you call — a null address
 * reaches nodemailer as "no recipients defined" and throws inside whatever
 * transaction you were in.
 */
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: Number(process.env.EMAIL_SERVER_PORT),
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
});

const emailStyles = `
  <style>
    body { font-family: 'Inter', -apple-system, sans-serif; background-color: #f7f9fe; margin: 0; padding: 20px; color: #181c20; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; padding: 40px; box-shadow: 0px 4px 12px rgba(24, 28, 32, 0.06); }
    .logo { width: 56px; height: 56px; background: linear-gradient(135deg, #0050cb 0%, #0066ff 100%); border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 24px; color: white; font-weight: bold; font-size: 24px; text-align: center; line-height: 56px;}
    .title { font-size: 24px; font-weight: 800; margin-bottom: 12px; color: #181c20; }
    .text { font-size: 16px; line-height: 1.5; color: #424656; margin-bottom: 24px; }
    .button { display: inline-block; background-color: #0050cb; color: #ffffff; font-weight: 600; text-decoration: none; padding: 14px 28px; border-radius: 9999px; text-align: center; }
    .footer { font-size: 14px; color: #727687; margin-top: 40px; text-align: center; }
  </style>
`;

/** What nodemailer accepts for a file attachment; only the PDF path is used. */
interface InvoiceAttachment {
  filename: string;
  path: string;
  contentType: string;
}

export async function sendInvoiceEmail(
  email: string,
  customerName: string,
  orderId: string,
  totalAmount: number,
  invoicePath: string
) {
  const fs = await import('fs');
  const path = await import('path');

  const absolutePath = path.join(process.cwd(), 'public', invoicePath.replace(/^\//, ''));

  // Send the mail even when the PDF is missing. The customer's money has
  // already moved, so a confirmation with no attachment is far better than no
  // confirmation because a file write failed.
  const attachments: InvoiceAttachment[] = [];
  if (fs.existsSync(absolutePath)) {
    attachments.push({
      filename: `AquaCart-Invoice-${orderId.slice(-8).toUpperCase()}.pdf`,
      path: absolutePath,
      contentType: 'application/pdf',
    });
  }

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `AquaCart - Payment Confirmed | Order #${orderId.slice(-6)}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>${emailStyles}</head>
      <body>
        <div class="container">
          <div class="logo">AQ</div>
          <h1 class="title">Payment Successful! 🎉</h1>
          <p class="text">Hi ${customerName}, your payment of <strong>₹${totalAmount.toFixed(2)}</strong> has been confirmed.</p>
          <div style="background-color: #f1f4f9; border-radius: 12px; padding: 20px; margin: 24px 0;">
            <p style="margin: 0; font-size: 14px; color: #424656;">Order ID: <strong style="color: #0050cb;">#${orderId.slice(-8).toUpperCase()}</strong></p>
            <p style="margin: 8px 0 0; font-size: 14px; color: #424656;">Status: <strong style="color: #22c55e;">Paid</strong></p>
          </div>
          <p class="text">Your invoice is attached to this email. You can also download it from your order history.</p>
          <div class="footer">&copy; ${new Date().getFullYear()} AquaCart. All rights reserved.</div>
        </div>
      </body>
      </html>
    `,
    attachments,
  };

  await transporter.sendMail(mailOptions);
}
