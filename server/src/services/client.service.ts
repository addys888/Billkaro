import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Get all clients for a user with invoice stats
 */
export async function getClientsForUser(
  userId: string,
  params: { page?: number; limit?: number; search?: string }
) {
  const { page = 1, limit = 20, search } = params;
  const skip = (page - 1) * limit;

  const where: any = { userId };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
    ];
  }

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { invoices: true } },
      },
    }),
    prisma.client.count({ where }),
  ]);

  return {
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      gstin: c.gstin,
      email: c.email,
      paymentScore: Number(c.paymentScore),
      totalInvoiced: Number(c.totalInvoiced),
      totalPaid: Number(c.totalPaid),
      totalPending: Number(c.totalInvoiced) - Number(c.totalPaid),
      avgDaysToPay: Number(c.avgDaysToPay),
      invoiceCount: c._count.invoices,
      createdAt: c.createdAt,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get a single client with full invoice history
 */
export async function getClientDetail(userId: string, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, userId },
    include: {
      invoices: {
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
    },
  });

  if (!client) return null;

  return {
    id: client.id,
    name: client.name,
    phone: client.phone,
    gstin: client.gstin,
    email: client.email,
    paymentScore: Number(client.paymentScore),
    totalInvoiced: Number(client.totalInvoiced),
    totalPaid: Number(client.totalPaid),
    totalPending: Number(client.totalInvoiced) - Number(client.totalPaid),
    avgDaysToPay: Number(client.avgDaysToPay),
    invoices: client.invoices.map((inv) => ({
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      status: inv.status,
      totalAmount: Number(inv.totalAmount),
      description: inv.description,
      dueDate: inv.dueDate,
      paidAt: inv.paidAt,
      createdAt: inv.createdAt,
    })),
    createdAt: client.createdAt,
  };
}

/**
 * Update client details
 */
export async function updateClient(
  userId: string,
  clientId: string,
  data: { name?: string; phone?: string; gstin?: string; email?: string }
) {
  return prisma.client.update({
    where: { id: clientId },
    data,
  });
}
