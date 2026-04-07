import { prisma } from '../../db/prisma';
import { PrismaClient, User } from '@prisma/client';
import { sendTextMessage, sendButtonMessage } from '../../services/whatsapp.service';
import { updateSession, clearSession, getSession } from '../session-manager';
import { ONBOARDING_STEPS } from '../../config/constants';
import { logger } from '../../utils/logger';



/**
 * Handle onboarding flow for new users
 */
export async function handleOnboardingStep(
  phone: string,
  input: string,
  existingUser: User | null
): Promise<void> {
  if (!existingUser) {
    // Brand new user — start onboarding
    await sendTextMessage({
      to: phone,
      text: `🎉 *Welcome to BillKaro!*\n\nLet's set up your business in 90 seconds.\n\n1️⃣ What is your *Business Name*?`,
    });

    // Create user placeholder
    await prisma.user.create({
      data: {
        phone,
        businessName: 'My Business',
        onboardingComplete: false,
      },
    });

    await updateSession(phone, {
      currentFlow: 'onboarding',
      currentStep: 'BUSINESS_NAME',
      flowData: {},
    });
    return;
  }

  // Get session state
  const session = await getSession(phone);
  const { currentStep, currentFlow } = session;

  // Dashboard-registered user messaging on WhatsApp for the first time
  // (user exists but no onboarding session was started via WhatsApp)
  if (!currentFlow || currentFlow !== 'onboarding') {
    await sendTextMessage({
      to: phone,
      text: `🎉 *Welcome to BillKaro!*\n\nLet's finish setting up your account in 90 seconds so you can start creating invoices via WhatsApp.\n\n1️⃣ What is your *Business Name*?`,
    });

    await updateSession(phone, {
      currentFlow: 'onboarding',
      currentStep: 'BUSINESS_NAME',
      flowData: {},
    });
    return; // Don't process the current message — wait for their reply
  }

  const step = currentStep || 'BUSINESS_NAME';

  switch (step) {
    case 'BUSINESS_NAME': {
      const name = input.trim();
      if (name.length < 2) {
        await sendTextMessage({ to: phone, text: 'Please enter a valid business name (at least 2 characters).' });
        return;
      }

      await prisma.user.update({
        where: { phone },
        data: { businessName: name },
      });

      await updateSession(phone, {
        currentStep: 'GSTIN',
        flowData: { businessName: name },
      });

      await sendTextMessage({
        to: phone,
        text: `✅ *${name}* — great name!\n\n2️⃣ What is your *GSTIN*?\n\n(Type "skip" if you don't have GST registration)`,
      });
      break;
    }

    case 'GSTIN': {
      let gstin: string | null = null;
      if (input.toLowerCase() !== 'skip') {
        gstin = input.trim().toUpperCase();
        // Basic GSTIN validation (15 chars)
        if (gstin.length !== 15) {
          await sendTextMessage({
            to: phone,
            text: '⚠️ GSTIN should be 15 characters (e.g., 27AAPCS1234F1Z5).\nPlease re-enter or type "skip".',
          });
          return;
        }
      }

      await prisma.user.update({
        where: { phone },
        data: { gstin },
      });

      await updateSession(phone, { currentStep: 'BUSINESS_ADDRESS' });

      await sendTextMessage({
        to: phone,
        text: `${gstin ? '✅ GSTIN saved!' : '✅ Skipped GSTIN.'}\n\n3️⃣ What is your *Business Address*?\n\n(e.g., "123 MG Road, Basti, UP 272001")\n\nType "skip" if you want to add it later.`,
      });
      break;
    }

    case 'BUSINESS_ADDRESS': {
      let address: string | null = null;
      if (input.toLowerCase() !== 'skip') {
        address = input.trim();
        if (address.length < 5) {
          await sendTextMessage({
            to: phone,
            text: '⚠️ Please enter a valid address (at least 5 characters) or type "skip".',
          });
          return;
        }
      }

      await prisma.user.update({
        where: { phone },
        data: { businessAddress: address },
      });

      await updateSession(phone, { currentStep: 'UPI_ID' });

      await sendTextMessage({
        to: phone,
        text: `${address ? '✅ Address saved!' : '✅ Skipped address.'}\n\n4️⃣ What is your *UPI ID* for receiving payments?\n\n(e.g., yourname@paytm, yourname@upi)\n\n💡 This is where your clients' money will land — *zero transaction fees!*`,
      });
      break;
    }

    case 'UPI_ID': {
      const upiId = input.trim();
      if (!upiId.includes('@')) {
        await sendTextMessage({
          to: phone,
          text: '⚠️ That doesn\'t look like a UPI ID. It should contain "@" (e.g., business@paytm).\nPlease try again.',
        });
        return;
      }

      await prisma.user.update({
        where: { phone },
        data: { upiId },
      });

      await updateSession(phone, { currentStep: 'BANK_DETAILS' });

      await sendButtonMessage({
        to: phone,
        bodyText: `✅ UPI ID saved!\n\n4️⃣ Want to add *Bank Account details* too?\n\n🏦 This shows NEFT/IMPS info on your invoice for clients who prefer bank transfer (especially for amounts > ₹1 Lakh).\n\n_Tip: Your QR code + UPI will always be on the invoice regardless._`,
        buttons: [
          { id: 'bank_yes', title: '✅ Add Bank Details' },
          { id: 'bank_skip', title: '⏭️ Skip' },
        ],
      });
      break;
    }

    case 'BANK_DETAILS': {
      if (input === 'bank_skip' || input.toLowerCase() === 'skip') {
        // Skip bank details — go to payment terms
        await updateSession(phone, { currentStep: 'PAYMENT_TERMS' });

        await sendButtonMessage({
          to: phone,
          bodyText: `✅ Skipped bank details — you can add them later.\n\n5️⃣ Default *payment terms*?\n(How many days do clients get to pay?)`,
          buttons: [
            { id: 'terms_7', title: '7 days' },
            { id: 'terms_15', title: '15 days' },
            { id: 'terms_30', title: '30 days' },
          ],
        });
        return;
      }

      if (input === 'bank_yes') {
        await updateSession(phone, { currentStep: 'BANK_ACCOUNT_NO' });
        await sendTextMessage({
          to: phone,
          text: '🏦 Enter your *Bank Account Number*:',
        });
        return;
      }

      // This shouldn't happen, but handle gracefully
      await sendButtonMessage({
        to: phone,
        bodyText: 'Would you like to add bank details?',
        buttons: [
          { id: 'bank_yes', title: '✅ Add Bank Details' },
          { id: 'bank_skip', title: '⏭️ Skip' },
        ],
      });
      break;
    }

    case 'BANK_ACCOUNT_NO': {
      const accountNo = input.trim().replace(/\s/g, '');
      if (accountNo.length < 8 || !/^\d+$/.test(accountNo)) {
        await sendTextMessage({
          to: phone,
          text: '⚠️ Please enter a valid bank account number (digits only).',
        });
        return;
      }

      await prisma.user.update({
        where: { phone },
        data: { bankAccountNo: accountNo },
      });

      await updateSession(phone, { currentStep: 'BANK_IFSC' });
      await sendTextMessage({
        to: phone,
        text: `✅ Account: ****${accountNo.slice(-4)}\n\nNow enter your *IFSC Code*:\n(e.g., SBIN0001234)`,
      });
      break;
    }

    case 'BANK_IFSC': {
      const ifsc = input.trim().toUpperCase();
      // Basic IFSC validation: 4 letters + 0 + 6 alphanumeric
      if (ifsc.length !== 11) {
        await sendTextMessage({
          to: phone,
          text: '⚠️ IFSC should be 11 characters (e.g., SBIN0001234).\nPlease try again.',
        });
        return;
      }

      await prisma.user.update({
        where: { phone },
        data: { bankIfsc: ifsc },
      });

      await updateSession(phone, { currentStep: 'BANK_NAME' });
      await sendTextMessage({
        to: phone,
        text: `✅ IFSC: ${ifsc}\n\nWhat is the *Account Holder Name* and *Bank Name*?\n\n(Send like: "Rahul Hardware, SBI" or type "skip")`,
      });
      break;
    }

    case 'BANK_NAME': {
      if (input.toLowerCase() !== 'skip') {
        // Try to parse "Account Name, Bank Name"
        const parts = input.split(',').map((p) => p.trim());
        const accountName = parts[0] || input.trim();
        const bankName = parts[1] || null;

        await prisma.user.update({
          where: { phone },
          data: {
            bankAccountName: accountName,
            bankName: bankName,
          },
        });
      }

      await updateSession(phone, { currentStep: 'PAYMENT_TERMS' });

      await sendButtonMessage({
        to: phone,
        bodyText: `✅ Bank details saved!\n\n5️⃣ Default *payment terms*?\n(How many days do clients get to pay?)`,
        buttons: [
          { id: 'terms_7', title: '7 days' },
          { id: 'terms_15', title: '15 days' },
          { id: 'terms_30', title: '30 days' },
        ],
      });
      break;
    }

    case 'PAYMENT_TERMS': {
      let days = 7;

      if (input === 'terms_7') days = 7;
      else if (input === 'terms_15') days = 15;
      else if (input === 'terms_30') days = 30;
      else {
        const parsed = parseInt(input, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 90) {
          await sendTextMessage({
            to: phone,
            text: '⚠️ Please choose a valid payment term (7, 15, or 30 days).',
          });
          return;
        }
        days = parsed;
      }

      await prisma.user.update({
        where: { phone },
        data: { defaultPaymentTermsDays: days },
      });

      await updateSession(phone, { currentStep: 'ADVANCE_PAYMENT' });

      await sendButtonMessage({
        to: phone,
        bodyText: `✅ Payment terms: ${days} days\n\n6️⃣ Enable *Advance Payment* tracking?\n\n💰 This lets you record partial/advance payments when creating invoices — useful if clients pay some amount upfront.\n\n_Most merchants find this helpful for large orders._`,
        buttons: [
          { id: 'advance_yes', title: '✅ Yes, Enable' },
          { id: 'advance_no', title: '⏭️ No, Skip' },
        ],
      });
      break;
    }

    case 'ADVANCE_PAYMENT': {
      const enableAdvance = input === 'advance_yes';

      await prisma.user.update({
        where: { phone },
        data: {
          enableAdvancePayment: enableAdvance,
          onboardingComplete: true,
        },
      });

      await clearSession(phone);

      const user = await prisma.user.findUnique({ where: { phone } });

      const bankInfo = user?.bankAccountNo
        ? `\n✅ Bank: ****${user.bankAccountNo.slice(-4)} (${user.bankIfsc})`
        : '';
      const advanceInfo = enableAdvance ? '\n✅ Advance Payments: Enabled' : '';

      await sendTextMessage({
        to: phone,
        text: `🎉 *All set, ${user?.businessName}!*\n\n✅ Business: ${user?.businessName}\n✅ GSTIN: ${user?.gstin || 'Not set'}\n✅ UPI: ${user?.upiId}${bankInfo}\n✅ Payment Terms: ${user?.defaultPaymentTermsDays} days${advanceInfo}\n\n💰 *Zero transaction fees* — money goes straight to your account!\n\n━━━━━━━━━━━━━━━━━━\n\nYou're ready! Just say:\n\n📄 *"Bill 5000 to Rahul for AC repair"*\n\nor send a voice note 🎤`,
      });

      logger.info('User onboarding complete', { phone: phone.slice(-4), businessName: user?.businessName });
      break;
    }
  }
}
