'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setToken, setUser } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.length < 10) {
      setError('Please enter a valid 10-digit phone number');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await apiFetch('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: `91${phone}` }),
      });
      setStep('otp');
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1);
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    const otpCode = otp.join('');
    if (otpCode.length !== 6) {
      setError('Please enter the complete 6-digit OTP');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await apiFetch<{ token: string; user: any }>('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: `91${phone}`, otp: otpCode }),
      });
      setToken(result.token);
      setUser(result.user);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo">
          Bill<span>Karo</span>
        </div>
        <p className="subtitle">
          WhatsApp-First Smart Invoicing & Collections
        </p>

        {error && (
          <div style={{
            background: '#fef2f2',
            color: '#dc2626',
            padding: '8px 12px',
            borderRadius: '8px',
            fontSize: '0.875rem',
            marginBottom: '16px',
          }}>
            {error}
          </div>
        )}

        {step === 'phone' ? (
          <form onSubmit={handleSendOTP}>
            <div className="form-group">
              <label>WhatsApp Phone Number</label>
              <div className="phone-input">
                <input
                  className="input phone-prefix"
                  value="+91"
                  disabled
                />
                <input
                  className="input"
                  type="tel"
                  placeholder="Enter 10-digit number"
                  value={phone}
                  onChange={(e) => {
                    let val = e.target.value.replace(/\D/g, '');
                    if (val.startsWith('91')) val = val.substring(2);
                    setPhone(val.slice(0, 10));
                  }}
                  maxLength={10}
                  autoFocus
                  id="phone-input"
                />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} id="send-otp-btn">
              {loading ? '⏳ Sending OTP...' : '📱 Send OTP via WhatsApp'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOTP}>
            <p style={{ fontSize: '0.875rem', color: '#475569', marginBottom: '20px' }}>
              We sent a 6-digit OTP to <strong>+91 {phone}</strong> on WhatsApp
            </p>
            <div className="form-group">
              <label>Enter OTP</label>
              <div className="otp-inputs">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    className="input"
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    id={`otp-input-${i}`}
                  />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
              <button className="btn btn-primary" type="submit" disabled={loading} id="verify-otp-btn" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                {loading ? '⏳ Verifying...' : '✅ Verify & Login'}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                style={{ width: '100%', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', fontSize: '13px', display: 'flex', justifyContent: 'center' }}
                onClick={() => { setStep('phone'); setOtp(['', '', '', '', '', '']); setError(''); }}
              >
                ← Change Number
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
