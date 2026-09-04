import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { db } from '@/lib/db';
import { fail } from '@/lib/api';

const UPLOAD_DIR = path.join(process.cwd(), 'upload');

/**
 * GET /api/media/[id] — serve a stored citizen-report photo.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[a-zA-Z0-9_-]{6,32}$/.test(id)) {
      return NextResponse.json({ error: 'Invalid media id' }, { status: 400 });
    }
    const asset = await db.mediaAsset.findUnique({ where: { id } });
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const safe = path.basename(asset.filename); // no traversal
    const file = path.join(UPLOAD_DIR, safe);
    const buf = await fs.readFile(file);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': asset.mime,
        'Cache-Control': 'public, max-age=86400, immutable',
        'Content-Length': String(buf.length),
      },
    });
  } catch (e) {
    return fail(e);
  }
}
