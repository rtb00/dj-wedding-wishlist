import { NextRequest, NextResponse } from 'next/server';

const DJ_PASSWORD = 'hochzeit2027';

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  if (password === DJ_PASSWORD) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Falsches Passwort.' }, { status: 401 });
}
