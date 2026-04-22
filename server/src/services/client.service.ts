import { prisma } from '../db/prisma';
import { PrismaClient } from '@prisma/client';



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
    clients: await Promise.all(clients.map(async (c) => {
      // BUG #6 FIX: Compute totals from actual invoice data, not stored counters
      const invoiceAgg = await prisma.invoice.aggregate({
        where: { clientId: c.id },
        _sum: { totalAmount: true, amountPaid: true },
      });
      const totalInvoiced = Number(invoiceAgg._sum.totalAmount || 0);
      const totalPaid = Number(invoiceAgg._sum.amountPaid || 0);

      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        gstin: c.gstin,
        email: c.email,
        paymentScore: Number(c.paymentScore),
        totalInvoiced,
        totalPaid,
        totalPending: totalInvoiced - totalPaid,
        avgDaysToPay: Number(c.avgDaysToPay),
        invoiceCount: c._count.invoices,
        createdAt: c.createdAt,
      };
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
    // BUG #6 FIX: Compute from actual invoices
    totalInvoiced: client.invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0),
    totalPaid: client.invoices.reduce((sum, inv) => sum + Number(inv.amountPaid || 0), 0),
    totalPending: client.invoices.reduce((sum, inv) => sum + Number(inv.totalAmount) - Number(inv.amountPaid || 0), 0),
    avgDaysToPay: Number(client.avgDaysToPay),
    invoices: client.invoices.map((inv) => ({
      id: inv.id,
      invoiceNo: inv.invoiceNo,
      status: inv.status,
      totalAmount: Number(inv.totalAmount),
      amountPaid: Number(inv.amountPaid || 0),
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
  // BUG #11 FIX: Verify ownership before updating
  const client = await prisma.client.findFirst({
    where: { id: clientId, userId },
  });
  if (!client) throw new Error('Client not found');

  return prisma.client.update({
    where: { id: clientId },
    data,
  });
}
