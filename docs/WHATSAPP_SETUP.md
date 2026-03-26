# 📱 BillKaro — WhatsApp Cloud API Setup

Detailed guide to configure Meta's WhatsApp Cloud API for BillKaro.

---

## 1. Create Meta Business App

1. Visit [developers.facebook.com/apps](https://developers.facebook.com/apps)
2. Click **Create App**
3. Select **Other** → **Business** type
4. Fill in app name: "BillKaro"
5. Add the **WhatsApp** product from the app dashboard

---

## 2. Phone Number Configuration

### Test Number (Development)
Meta provides a free test phone number for development:
- Go to WhatsApp > Getting Started
- Note the **Test Phone Number** and **Phone Number ID**
- You can send messages to up to 5 verified phone numbers

### Production Number
1. Go to WhatsApp > Getting Started > **Add Phone Number**
2. Use a dedicated business phone number
3. Verify via SMS or voice call
4. Set a display name (e.g., "BillKaro")

---

## 3. Access Token

### Temporary Token (24 hours)
- Available on the WhatsApp > Getting Started page
- Useful for quick testing only

### Permanent Token (Production)
1. Go to Business Settings > System Users
2. Create a System User with **Admin** role
3. Add the WhatsApp app with full permissions
4. Generate a token with scopes:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
5. Copy and save securely — this is your `WHATSAPP_ACCESS_TOKEN`

---

## 4. Webhook Configuration

### Endpoint
Set your webhook URL in Meta Dashboard:
```
https://your-domain.com/webhook/whatsapp
```

For local development with ngrok:
```
https://abc123.ngrok.io/webhook/whatsapp
```

### Verify Token
Set a custom string as the verify token (any random string).
This must match your `WHATSAPP_VERIFY_TOKEN` env variable.

### Subscribed Fields
Subscribe to these webhook fields:
- ✅ `messages` — Incoming text, media, interactive messages
- ✅ `message_status` — Delivery/read receipts

---

## 5. Message Templates (for Reminders)

WhatsApp Business API requires **pre-approved templates** for outbound messages sent outside the 24-hour customer service window.

### Template: Invoice Delivery
```
Name: invoice_delivery
Category: UTILITY
Language: en

Body:
🧾 *Invoice from {{1}}*

Hi {{2}},

Please find your invoice #{{3}} for ₹{{4}} ({{5}}).

💳 Pay securely: {{6}}

Due by: {{7}}

Thank you for your business! 🙏
```

### Template: Payment Reminder
```
Name: payment_reminder
Category: UTILITY
Language: en

Body:
Hi {{1}} 🙏,

A friendly reminder that invoice #{{2}} for ₹{{3}} is due today.

💳 Quick Pay: {{4}}

Thank you!
— {{5}}
```

### Template: Overdue Reminder
```
Name: overdue_reminder
Category: UTILITY
Language: en

Body:
Hi {{1}},

This is a reminder that invoice #{{2}} for ₹{{3}}
is now {{4}} days overdue (due: {{5}}).

💳 Pay now: {{6}}
📞 Questions? Call {{7}}

— {{8}}
```

### Template: Payment Confirmation
```
Name: payment_confirmation
Category: UTILITY
Language: en

Body:
✅ Payment of ₹{{1}} received for Invoice #{{2}}.

Thank you, {{3}}! 🙏

— {{4}}
```

### Submitting Templates
1. Go to WhatsApp > Message Templates
2. Create each template above
3. Wait for Meta approval (usually 24-48 hours)
4. Templates must be approved before sending reminder messages

---

## 6. API Rate Limits

| Tier | Messages/sec | Daily Limit |
|---|---|---|
| Unverified | 250 | 250 |
| Tier 1 | 1,000 | 1,000 |
| Tier 2 | 10,000 | 10,000 |
| Tier 3 | 100,000 | 100,000 |

You start at Tier 1 after phone verification. Upgrade happens automatically based on messaging quality.

---

## 7. Environment Variables Needed

```env
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxx
WHATSAPP_VERIFY_TOKEN=my-custom-verify-token
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789012345
WHATSAPP_API_VERSION=v21.0
```
