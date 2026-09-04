'use client';

import { useState } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, Button, Stack, Chip, Divider, Alert, InputAdornment, IconButton,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import LandscapeIcon from '@mui/icons-material/Landscape';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  district: string | null;
}

const DEMO_ACCOUNTS = [
  { email: 'admin@bhrakshak.in', pw: 'Admin@123', label: 'Platform Admin', role: 'admin' },
  { email: 'dc.ekh@bhrakshak.in', pw: 'District@123', label: 'DC East Khasi Hills', role: 'district_admin' },
  { email: 'field.noney@bhrakshak.in', pw: 'Field@123', label: 'Field Official', role: 'field_official' },
  { email: 'citizen@bhrakshak.in', pw: 'Citizen@123', label: 'Citizen', role: 'citizen' },
];

export default function LoginGate({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const login = useMutation({
    mutationFn: async (creds: { email: string; password: string }) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      return data.user as SessionUser;
    },
    onSuccess: (u) => {
      qc.clear();
      onLogin(u);
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!email || !password) {
      setError('Enter your email and password');
      return;
    }
    login.mutate({ email, password });
  };

  const quickFill = (acc: typeof DEMO_ACCOUNTS[number]) => {
    setEmail(acc.email);
    setPassword(acc.pw);
    setError(null);
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(1100px 500px at 80% -10%, rgba(16,185,129,.14), transparent), radial-gradient(900px 500px at 10% 110%, rgba(56,189,248,.08), transparent), #070c14',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 440, width: '100%', p: 1 }}>
        <CardContent>
          <Stack direction="row" spacing={1.5} sx={{ mb: 2, alignItems: 'center' }}>
            <Box
              sx={{
                width: 44, height: 44, borderRadius: 2, display: 'grid', placeItems: 'center',
                bgcolor: 'rgba(16,185,129,.14)', border: '1px solid rgba(16,185,129,.35)',
              }}
            >
              <LandscapeIcon sx={{ color: 'primary.main' }} />
            </Box>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-.02em' }}>
                BhuRakshak
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Landslide Early Warning · North East India
              </Typography>
            </Box>
          </Stack>

          <Divider sx={{ mb: 2 }} />

          <form onSubmit={submit}>
            <Stack spacing={2}>
              <TextField
                label="Email"
                type="email"
                size="small"
                fullWidth
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
              />
              <TextField
                label="Password"
                type={showPw ? 'text' : 'password'}
                size="small"
                fullWidth
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setShowPw((v) => !v)} edge="end" aria-label="toggle password">
                          {showPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              {error && <Alert severity="error" variant="outlined" sx={{ py: 0 }}>{error}</Alert>}
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={login.isPending}
                sx={{ py: 1.2, fontWeight: 700 }}
              >
                {login.isPending ? 'Signing in…' : 'Sign in to Command Center'}
              </Button>
            </Stack>
          </form>

          <Divider sx={{ my: 2.5 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>demo accounts — tap to fill</Typography>
          </Divider>

          <Stack spacing={0.75}>
            {DEMO_ACCOUNTS.map((acc) => (
              <Button
                key={acc.email}
                size="small"
                onClick={() => quickFill(acc)}
                sx={{ justifyContent: 'space-between', textTransform: 'none', px: 1.5 }}
                variant="outlined"
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip
                    size="small"
                    label={acc.role}
                    sx={{ height: 18, fontSize: 10, fontWeight: 700, bgcolor: 'rgba(16,185,129,.12)' }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{acc.label}</Typography>
                </Stack>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {acc.email}
                </Typography>
              </Button>
            ))}
          </Stack>

          <Typography variant="caption" sx={{ display: 'block', mt: 2, textAlign: 'center', color: 'text.secondary' }}>
            SIH26001 · MDoNER · 4-layer early warning: WHERE → WHEN → IS IT MOVING → WHO&apos;S IN THE WAY
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
