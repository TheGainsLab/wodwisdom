# Resend SMTP for Supabase Auth

WOD Wisdom uses Resend for production auth emails (signup confirmation, password reset) instead of Supabase's built-in mailer.

## Prerequisites

- [Verify your domain](https://resend.com/domains) in Resend
- [Create an API key](https://resend.com/api-keys) in Resend

## Supabase Dashboard Setup

### 1. Enable email confirmation

1. Go to **Authentication → Providers → Email**
2. Enable **Confirm email**

### 2. Configure Resend SMTP

1. Go to **Authentication → Email Templates → SMTP Settings** (or **Project Settings → Auth → SMTP**)
2. Enable **Custom SMTP**
3. Enter Resend credentials:

| Field       | Value                     |
|------------|---------------------------|
| Host       | `smtp.resend.com`         |
| Port       | `465`                     |
| Username   | `resend`                  |
| Password   | Your Resend API key       |
| Sender email | `noreply@wodwisdom.app` (or your verified domain) |
| Sender name  | `WOD Wisdom`              |

4. Save

### 3. Allow redirect URLs

Ensure your app URL is in **Authentication → URL Configuration → Redirect URLs** (e.g. `https://wodwisdom.app`, `https://*.vercel.app` for previews, `http://localhost:5173` for local dev).

## Result

- Signup confirmation emails and password reset emails are sent via Resend
- Users must confirm their email before accessing the app (prevents fake-email abuse)
- Coach invites (from `invite-coach` edge function) continue to use Resend API directly
