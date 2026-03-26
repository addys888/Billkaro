# 📡 BillKaro — API Reference

Base URL: `http://localhost:4000` (development)

All authenticated endpoints require `Authorization: Bearer <token>` header.

---

## Authentication

### Send OTP
```
POST /api/auth/send-otp
Content-Type: application/json

{
  "phone": "919876543210"
}

Response 200:
{
  "success": true,
  "message": "OTP sent via WhatsApp"
}
```

### Verify OTP
```
POST /api/auth/verify-otp
Content-Type: application/json

{
  "phone": "919876543210",
  "otp": "123456"
}

Response 200:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "phone": "919876543210",
    "businessName": "Sharma HVAC",
    "gstin": "27AAPCS1234F1Z5"
  }
}
```

---

## Dashboard

### Get Overview Stats
```
GET /api/dashboard/overview?period=month
Authorization: Bearer <token>

Response 200:
{
  "totalInvoiced": 320000,
  "totalCollected": 180000,
  "totalPending": 140000,
  "totalOverdue": 45000,
  "invoiceCount": 42,
  "paidCount": 24,
  "pendingCount": 15,
  "overdueCount": 3,
  "collectionRate": 56.25,
  "avgDaysToPay": 9.2,
  "overdueInvoices": [
    {
      "id": "uuid",
      "invoiceNo": "BK-2026-0047",
      "clientName": "Priya Constructions",
      "totalAmount": 22000,
      "daysOverdue": 12
    }
  ]
}
```

### Get Trends
```
GET /api/dashboard/trends?months=6
Authorization: Bearer <token>

Response 200:
{
  "months": [
    { "month": "Oct 2025", "invoiced": 250000, "collected": 200000 },
    { "month": "Nov 2025", "invoiced": 280000, "collected": 210000 },
    ...
  ]
}
```

---

## Invoices

### List Invoices
```
GET /api/invoices?status=pending&page=1&limit=20&search=priya
Authorization: Bearer <token>

Response 200:
{
  "invoices": [...],
  "total": 42,
  "page": 1,
  "totalPages": 3
}
```

### Get Invoice
```
GET /api/invoices/:id
Authorization: Bearer <token>

Response 200:
{
  "id": "uuid",
  "invoiceNo": "BK-2026-0047",
  "status": "pending",
  "clientName": "Priya Constructions",
  "clientPhone": "919876543210",
  "subtotal": 8500,
  "gstRate": 18,
  "gstAmount": 1530,
  "totalAmount": 10030,
  "description": "Waterproofing work",
  "lineItems": [
    { "name": "Waterproofing", "quantity": 1, "rate": 8500, "amount": 8500 }
  ],
  "pdfUrl": "https://invoices.billkaro.in/BK-2026-0047.pdf",
  "paymentLink": "https://rzp.io/i/abc123",
  "dueDate": "2026-04-02",
  "createdAt": "2026-03-26T10:00:00Z"
}
```

### Mark Invoice as Paid
```
PATCH /api/invoices/:id/mark-paid
Authorization: Bearer <token>
Content-Type: application/json

{
  "paymentMethod": "cash",
  "notes": "Received in person"
}

Response 200:
{
  "success": true,
  "invoice": { ... }
}
```

### Resend Invoice
```
POST /api/invoices/:id/resend
Authorization: Bearer <token>

Response 200:
{
  "success": true,
  "message": "Invoice resent to client via WhatsApp"
}
```

---

## Clients

### List Clients
```
GET /api/clients?page=1&limit=20&search=priya
Authorization: Bearer <token>

Response 200:
{
  "clients": [
    {
      "id": "uuid",
      "name": "Priya Constructions",
      "phone": "919876543210",
      "gstin": null,
      "invoiceCount": 12,
      "totalPending": 22000,
      "paymentScore": 3.5,
      "createdAt": "2025-10-15T08:00:00Z"
    }
  ],
  "total": 34,
  "page": 1,
  "totalPages": 2
}
```

### Get Client Detail
```
GET /api/clients/:id
Authorization: Bearer <token>

Response 200:
{
  "id": "uuid",
  "name": "Priya Constructions",
  "phone": "919876543210",
  "gstin": "27AALCP5678G1Z2",
  "totalInvoiced": 145000,
  "totalPending": 22000,
  "paymentScore": 3.5,
  "avgDaysToPay": 11.3,
  "invoices": [...]
}
```

---

## Webhooks (Internal)

### WhatsApp Webhook Verification
```
GET /webhook/whatsapp?hub.mode=subscribe&hub.verify_token=xxx&hub.challenge=xxx
Response: hub.challenge value (plain text)
```

### WhatsApp Incoming Message
```
POST /webhook/whatsapp
Body: Meta webhook payload (see WhatsApp Cloud API docs)
Response: 200
```

### Razorpay Payment Webhook
```
POST /webhook/razorpay
Headers: x-razorpay-signature: <signature>
Body: Razorpay webhook payload
Response: 200 { "status": "ok" }
```
