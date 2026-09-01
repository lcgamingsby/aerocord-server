import nodemailer from 'nodemailer';

interface SendVerificationEmailOptions {
  to: string;
  username: string;
  code: string;
}

export const sendVerificationEmail = async ({ to, username, code }: SendVerificationEmailOptions): Promise<{ success: boolean; error?: string }> => {
  const resendApiKey = process.env.RESEND_API_KEY || (process.env.SMTP_PASS?.startsWith('re_') ? process.env.SMTP_PASS : undefined);
  const brevoApiKey = process.env.BREVO_API_KEY || (process.env.SMTP_PASS?.startsWith('xkeysib-') ? process.env.SMTP_PASS : undefined);

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || (user ? `"AeroCord Verification" <${user}>` : '"AeroCord" <onboarding@resend.dev>');
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  const subject = `[AeroCord] ${code} adalah kode verifikasi akun Anda`;
  const textContent = `Halo ${username},\n\nKode verifikasi pendaftaran akun AeroCord Anda adalah: ${code}\n\nKode ini berlaku selama 10 menit.\nJangan berikan kode ini kepada siapapun.\n\nSalam,\nTim AeroCord`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verifikasi Akun AeroCord</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #0b0c10;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #e2e8f0;
    }
    .container {
      max-width: 520px;
      margin: 40px auto;
      background-color: #13161f;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }
    .header {
      background: linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%);
      padding: 30px 24px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 900;
      letter-spacing: -0.5px;
      color: #ffffff;
    }
    .header p {
      margin: 6px 0 0 0;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.9);
    }
    .content {
      padding: 32px 28px;
    }
    .greeting {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 12px;
    }
    .message {
      font-size: 14px;
      line-height: 1.6;
      color: #94a3b8;
      margin-bottom: 24px;
    }
    .code-box {
      background-color: #0b0c10;
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 16px;
      padding: 20px;
      text-align: center;
      margin-bottom: 24px;
    }
    .code-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #818cf8;
      margin-bottom: 8px;
    }
    .code-value {
      font-family: 'SF Mono', Consolas, Monaco, monospace;
      font-size: 32px;
      font-weight: 900;
      letter-spacing: 6px;
      color: #ffffff;
    }
    .expiry {
      font-size: 12px;
      color: #64748b;
      margin-top: 8px;
    }
    .footer {
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding: 20px 28px;
      background-color: #0d0f14;
      text-align: center;
      font-size: 12px;
      color: #64748b;
      line-height: 1.5;
    }
    .warning {
      color: #f43f5e;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>AeroCord</h1>
      <p>Next-Gen Realtime Voice & Chat Platform</p>
    </div>
    <div class="content">
      <div class="greeting">Halo ${username},</div>
      <div class="message">
        Terima kasih telah mendaftar di <strong>AeroCord</strong>! Untuk menyelesaikan pendaftaran dan mengamankan akun Anda, silakan masukkan kode verifikasi 6-digit berikut pada halaman registrasi:
      </div>
      <div class="code-box">
        <div class="code-label">KODE VERIFIKASI ANDA</div>
        <div class="code-value">${code}</div>
        <div class="expiry">⏱ Berlaku selama 10 menit</div>
      </div>
      <div class="message">
        <span class="warning">Penting:</span> Jangan bagikan kode ini kepada siapapun termasuk staf AeroCord. Jika Anda tidak merasa mendaftar di AeroCord, Anda bisa mengabaikan email ini.
      </div>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} AeroCord Platform. Hak cipta dilindungi.<br/>
      Email ini dikirim secara otomatis untuk verifikasi keamanan akun.
    </div>
  </div>
</body>
</html>
  `;

  // =========================================================================
  // 1. METHOD 1: Resend HTTPS REST API (Port 443 - 100% Never Timeout)
  // =========================================================================
  if (resendApiKey) {
    try {
      const fromEmail = process.env.RESEND_FROM || 'AeroCord <onboarding@resend.dev>';
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [to],
          subject,
          html: htmlContent,
          text: textContent
        })
      });

      const data: any = await res.json();
      if (!res.ok) {
        console.error('[EmailService:Resend] Error response:', data);
        return { 
          success: false, 
          error: data.message || data.error || 'Gagal mengirim email via Resend API.' 
        };
      }
      return { success: true };
    } catch (err: any) {
      console.error('[EmailService:Resend] Fetch error:', err);
      return { success: false, error: `Gagal mengirim email via Resend: ${err.message}` };
    }
  }

  // =========================================================================
  // 2. METHOD 2: Brevo HTTPS REST API (Port 443 - 100% Never Timeout)
  // =========================================================================
  if (brevoApiKey) {
    try {
      const senderEmail = user || 'no-reply@aerocord.app';
      const senderName = 'AeroCord Security';
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoApiKey.trim(),
          'Content-Type': 'application/json',
          'accept': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: to, name: username }],
          subject,
          htmlContent,
          textContent
        })
      });

      const data: any = await res.json();
      if (!res.ok) {
        console.error('[EmailService:Brevo] Error response:', data);
        return { 
          success: false, 
          error: data.message || 'Gagal mengirim email via Brevo API.' 
        };
      }
      return { success: true };
    } catch (err: any) {
      console.error('[EmailService:Brevo] Fetch error:', err);
      return { success: false, error: `Gagal mengirim email via Brevo: ${err.message}` };
    }
  }

  // =========================================================================
  // 3. METHOD 3: Standard SMTP (with Port 465 / 587 and timeout settings)
  // =========================================================================
  if (!host || !user || !pass) {
    console.warn('[EmailService] SMTP credentials not configured (SMTP_HOST, SMTP_USER, SMTP_PASS). Verification code for', to, 'is:', code);
    return { 
      success: false, 
      error: 'Layanan email belum dikonfigurasi. Tambahkan RESEND_API_KEY atau SMTP_HOST & SMTP_PASS di Railway.' 
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: {
        user,
        pass,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    await transporter.sendMail({
      from,
      to,
      subject,
      text: textContent,
      html: htmlContent,
    });

    return { success: true };
  } catch (err: any) {
    console.error('[EmailService:SMTP] Error sending to', to, ':', err);
    return { 
      success: false, 
      error: `Gagal mengirim email via SMTP: ${err.message || 'Connection timeout. Gunakan port 465 (SSL) atau gunakan RESEND_API_KEY / BREVO_API_KEY.'}` 
    };
  }
};
