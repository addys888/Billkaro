/**
 * Format number in Indian currency style (₹1,00,000)
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format number in Indian number system without currency symbol
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-IN').format(num);
}

/**
 * Parse amount from words (basic Hindi/English support)
 */
export function parseAmountFromWords(text: string): number | null {
  const wordMap: Record<string, number> = {
    hazaar: 1000,
    hazar: 1000,
    thousand: 1000,
    lakh: 100000,
    lac: 100000,
    crore: 10000000,
    sau: 100,
    hundred: 100,
  };

  // Try direct number match first
  const directMatch = text.match(/[\d,]+\.?\d*/);
  if (directMatch) {
    return parseFloat(directMatch[0].replace(/,/g, ''));
  }

  // Try word-based parsing: "paanch hazaar" → 5000
  let total = 0;
  const words = text.toLowerCase().split(/\s+/);
  let currentNum = 0;

  for (const word of words) {
    const num = parseHindiNumber(word);
    if (num !== null) {
      currentNum = num;
    } else if (wordMap[word]) {
      total += (currentNum || 1) * wordMap[word];
      currentNum = 0;
    }
  }

  total += currentNum;
  return total > 0 ? total : null;
}

function parseHindiNumber(word: string): number | null {
  const hindiNumbers: Record<string, number> = {
    ek: 1, do: 2, teen: 3, char: 4, paanch: 5,
    panch: 5, che: 6, saat: 7, aath: 8, nau: 9,
    das: 10, gyarah: 11, barah: 12, terah: 13,
    chaudah: 14, pandrah: 15, solah: 16, satrah: 17,
    atharah: 18, unnees: 19, bees: 20, pachees: 25,
    tees: 30, paintees: 35, chalees: 40, pachaas: 50,
    saath: 60, sattar: 70, assi: 80, nabbe: 90,
  };

  if (hindiNumbers[word] !== undefined) return hindiNumbers[word];

  const parsed = parseInt(word, 10);
  return isNaN(parsed) ? null : parsed;
}
