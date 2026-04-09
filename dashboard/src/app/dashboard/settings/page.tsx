'use client';

export default function SettingsPage() {
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
              defaultValue="Sharma HVAC Solutions" 
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none' }}
              disabled
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>UPI ID (for zero-fee payments)</label>
            <input 
              type="text" 
              defaultValue="business@upi" 
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '10px 12px', color: 'var(--color-text)', outline: 'none' }}
              disabled
            />
          </div>
        </div>

        <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end' }}>
          <button style={{ background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px 24px', fontWeight: 600, cursor: 'not-allowed', opacity: 0.7 }}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
