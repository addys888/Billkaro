'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn, apiFetch } from '@/lib/api';

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.push('/login');
      return;
    }
    
    // Fetch live profile from database to ensure up-to-date address / UPI parameters
    apiFetch<{user: any}>('/api/auth/me')
      .then(res => {
         setUser(res.user);
      })
      .catch(err => {
         console.error('Failed to fetch latest profile:', err);
      });
  }, [router]);

  if (!user) return null;

  return (
    <div style={{ padding: '24px', color: 'var(--color-text)' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '24px' }}>Settings</h2>
      
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '32px', maxWidth: '600px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Dashboard Profile</h3>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '32px' }}>
          Manage your business information, bank details, and notification preferences.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Business Name</label>
            <input 
              type="text" 
              defaultValue={user?.businessName || ''} 
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none', transition: 'border-color 0.2s' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>UPI ID (for zero-fee payments)</label>
            <input 
              type="text" 
              defaultValue={user?.upiId || ''} 
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none', transition: 'border-color 0.2s' }}
            />
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Required to receive direct Google Pay, PhonePe, or Paytm transfers.</span>
          </div>

          {/* Bank Details section */}
          <div style={{ padding: '20px', border: '1px dashed var(--color-border)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--color-bg)' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>Bank Details</div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
               <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                 <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Account Number</label>
                 <input 
                   type="text" 
                   defaultValue={user?.bankDetails?.accountNo || ''}
                   placeholder="e.g. 50100012345678"
                   style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none' }}
                 />
               </div>
               <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                 <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>IFSC Code</label>
                 <input 
                   type="text" 
                   defaultValue={user?.bankDetails?.ifsc || ''}
                   placeholder="e.g. HDFC0001234"
                   style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none' }}
                 />
               </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
               <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Beneficiary Name</label>
               <input 
                 type="text" 
                 defaultValue={user?.bankDetails?.beneficiaryName || ''}
                 placeholder="As it appears on bank statement"
                 style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none' }}
               />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Business Address</label>
            <textarea 
              rows={3}
              defaultValue={user?.address || ''}
              placeholder="Full billing address to be embedded in invoices"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none', resize: 'vertical' }}
            />
          </div>
        </div>

        <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button style={{ background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 24px', fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px 24px', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s' }}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
