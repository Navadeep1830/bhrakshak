'use client';

import { useState } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import PhoneApp from '@/components/app/PhoneApp';
import type { SessionUser } from '@/components/login-gate';

/**
 * /mobile — the standalone field-app surface used by the BhuRakshak APK.
 *
 * No website login is required: the app authenticates as a REGISTERED DEVICE
 * (x-device-id header — see /api/app/register) and talks to the same engine,
 * maps, routing and comms APIs as the website. The profile below only sets the
 * display name; the real identity of this phone is its device registration,
 * which the command center can see in Operations → Comms & SMS.
 */

const PROFILE_KEY = 'bhr-mobile-profile';

const DEFAULT_PROFILE: SessionUser = {
  id: 'local',
  email: '',
  fullName: 'Field Official',
  role: 'field',
  district: null,
};

export default function MobilePage() {
  // read once on first render (client component — localStorage is available)
  const [profile] = useState<SessionUser | null>(() => {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      return raw ? { ...DEFAULT_PROFILE, ...JSON.parse(raw) } : DEFAULT_PROFILE;
    } catch {
      return DEFAULT_PROFILE;
    }
  });

  if (!profile) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: '#070c14' }}>
        <Box sx={{ textAlign: 'center' }}>
          <LinearProgress sx={{ width: 200, mb: 2 }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            BhuRakshak Field — connecting…
          </Typography>
        </Box>
      </Box>
    );
  }

  // standalone mode: no onExit → no back-to-website button (this IS the app)
  return <PhoneApp user={profile} />;
}
