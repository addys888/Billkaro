'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn, apiFetch } from '@/lib/api';

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Controlled form state
  const [formData, setFormData] = useState({
    businessName: '',
    upiId: '',
    accountNo: '',
    ifsc: '',
    beneficiaryName: '',
    address: '',
    defaultPaymentTermsDays: '7'
  });

  useEffect(() => {
    if (!isLoggedIn()) {
      router.push('/login');
      return;
    }
    
    // Fetch live profile from database to ensure up-to-date address / UPI parameters
    apiFetch<{user: any}>('/api/auth/me')
      .then(res => {
         setUser(res.user);
         setFormData({
           businessName: res.user.businessName || '',
           upiId: res.user.upiId || '',
           accountNo: res.user.bankDetails?.accountNo || '',
           ifsc: res.user.bankDetails?.ifsc || '',
           beneficiaryName: res.user.bankDetails?.beneficiaryName || '',
           address: res.user.address || '',
           defaultPaymentTermsDays: String(res.user.defaultPaymentTermsDays || 7)
         });
      })
      .catch(err => {
         console.error('Failed to fetch latest profile:', err);
      });
  }, [router]);

  if (!user) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage('');
    try {
      await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
           upiId: formData.upiId,
           address: formData.address,
           bankAccountNo: formData.accountNo,
           bankIfsc: formData.ifsc,
           bankAccountName: formData.beneficiaryName,
           defaultPaymentTermsDays: parseInt(formData.defaultPaymentTermsDays, 10) || 7
        })
      });
      setMessage('Profile saved successfully!');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Failed to save', error);
      setMessage('Failed to save profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ padding: '24px', color: 'var(--color-text)' }}>
      <style>{`
        @keyframes toastFade {
          0% { opacity: 0; transform: translate(-50%, -40%) scale(0.95); }
          10% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          90% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.95); pointer-events: none; }
        }
      `}</style>

      {/* Floating Center Toast Notification */}
      {message && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 9999,
          background: message.includes('Failed') ? 'rgba(239, 68, 68, 0.95)' : 'rgba(16, 185, 129, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 20px rgba(16, 185, 129, 0.3)',
          backdropFilter: 'blur(16px)',
          padding: '32px 48px',
          borderRadius: '20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
          color: '#ffffff',
          animation: 'toastFade 3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
        }}>
           <div style={{ 
              width: '64px', height: '64px', 
              borderRadius: '50%', 
              background: 'rgba(255, 255, 255, 0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '32px'
           }}>
             {message.includes('Failed') ? '⚠️' : '✨'}
           </div>
           <div style={{ fontSize: '18px', fontWeight: 600, letterSpacing: '-0.01em' }}>
             {message}
           </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
         <h2 style={{ fontSize: '20px', fontWeight: 600 }}>Settings</h2>
      </div>
      
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '32px', maxWidth: '600px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Dashboard Profile</h3>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '32px' }}>
          Manage your business information, bank details, and notification preferences.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              Business Name
              <span style={{ fontSize: '10px', background: 'var(--color-border)', color: 'var(--color-text-muted)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, letterSpacing: '0.3px' }}>LOCKED</span>
            </label>
            <input 
              type="text" 
              name="businessName"
              value={formData.businessName} 
              readOnly
              disabled
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text-muted)', outline: 'none', cursor: 'not-allowed', opacity: 0.7 }}
            />
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Business name is set during onboarding and cannot be changed here. Contact support if needed.</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>UPI ID (for zero-fee payments)</label>
            <input 
              type="text" 
              name="upiId"
              value={formData.upiId} 
              onChange={handleChange}
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
                   name="accountNo"
                   value={formData.accountNo}
                   onChange={handleChange}
                   placeholder="e.g. 50100012345678"
                   style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none' }}
                 />
               </div>
               <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                 <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>IFSC Code</label>
                 <input 
                   type="text" 
                   name="ifsc"
                   value={formData.ifsc}
                   onChange={handleChange}
                   placeholder="e.g. HDFC0001234"
                   style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none' }}
                 />
               </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
               <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Beneficiary Name</label>
               <input 
                 type="text" 
                 name="beneficiaryName"
                 value={formData.beneficiaryName}
                 onChange={handleChange}
                 placeholder="As it appears on bank statement"
                 style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none' }}
               />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Business Address</label>
            <textarea 
              rows={3}
              name="address"
              value={formData.address}
              onChange={handleChange}
              placeholder="Full billing address to be embedded in invoices"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none', resize: 'vertical' }}
            />
          </div>

          {/* Invoice Default Settings */}
          <div style={{ padding: '20px', border: '1px dashed var(--color-border)', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--color-bg)' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>Invoice Defaults</div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Default Payment Terms (Days)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input 
                  type="number" 
                  name="defaultPaymentTermsDays"
                  value={formData.defaultPaymentTermsDays}
                  onChange={handleChange}
                  min={1}
                  max={90}
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none', width: '100px', textAlign: 'center', fontSize: '16px', fontWeight: 600 }}
                />
                <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>days</span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>Number of days after invoice creation before payment is due. Reminders will start from this date. (1–90 days)</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button 
             onClick={() => router.push('/dashboard')}
             style={{ background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 24px', fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button 
             onClick={handleSave}
             disabled={isSaving}
             style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px 24px', fontWeight: 600, cursor: isSaving ? 'not-allowed' : 'pointer', transition: 'background 0.2s', opacity: isSaving ? 0.7 : 1 }}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
