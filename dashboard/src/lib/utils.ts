/**
 * Format a number as Indian currency (₹1,00,000)
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format a number in Indian format
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-IN').format(num);
}

/**
 * Format amount in compact form (₹1.2L, ₹50K)
 */
export function formatCompact(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return `₹${amount}`;
}

/**
 * Format date as DD MMM YYYY
 */
export function formatDate(dateStr: string | Date): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format relative date (e.g., "2 days ago")
 */
export function formatRelativeDate(dateStr: string | Date): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return formatDate(date);
}

/**
 * Get initials from a name
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || '')
    .join('');
}

/**
 * Generate star rating display
 */
export function getStarRating(score: number): { filled: number; empty: number } {
  const filled = Math.round(score);
  return { filled: Math.min(filled, 5), empty: Math.max(5 - filled, 0) };
}

/**
 * Get status color class
 */
export function getStatusBadge(status: string): { className: string; label: string } {
  switch (status.toUpperCase()) {
    case 'PAID': return { className: 'badge-success', label: 'Paid ✅' };
    case 'PENDING': return { className: 'badge-warning', label: 'Pending' };
    case 'PARTIALLY_PAID': return { className: 'badge-partial', label: 'Partial 🟡' };
    case 'OVERDUE': return { className: 'badge-danger', label: 'Overdue' };
    case 'CANCELLED': return { className: 'badge-info', label: 'Cancelled' };
    default: return { className: 'badge-info', label: status };
  }
}
