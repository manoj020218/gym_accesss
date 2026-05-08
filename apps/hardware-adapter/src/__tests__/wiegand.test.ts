import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the bit-parsing logic extracted from WiegandReader.
// We test the pure function in isolation without needing real GPIO.

function parseBits(bits: number[], bitFormat: 26 | 34): string | null {
  if (bits.length !== bitFormat) return null;
  const data = bits.slice(1, bitFormat - 1);
  const facilityBits = bitFormat === 26 ? 8 : 16;
  const cardBits     = 16;

  let facility = 0;
  for (let i = 0; i < facilityBits; i++) facility = (facility << 1) | (data[i] ?? 0);

  let card = 0;
  for (let i = facilityBits; i < facilityBits + cardBits; i++) card = (card << 1) | (data[i] ?? 0);

  return Buffer.from([
    (facility >> 8) & 0xff,
    facility & 0xff,
    (card >> 8) & 0xff,
    card & 0xff,
  ]).toString('hex').toUpperCase();
}

// Build a valid 26-bit Wiegand frame (even parity + 8-bit facility + 16-bit card + odd parity)
function makeWiegand26(facility: number, card: number): number[] {
  const bits: number[] = new Array(26).fill(0);
  for (let i = 0; i < 8; i++)  bits[8  - i] = (facility >> i) & 1;
  for (let i = 0; i < 16; i++) bits[24 - i] = (card     >> i) & 1;

  // Even parity over bits 1–12
  let ep = 0; for (let i = 1; i <= 12; i++) ep ^= bits[i]!;
  bits[0] = ep;

  // Odd parity over bits 13–24
  let op = 1; for (let i = 13; i <= 24; i++) op ^= bits[i]!;
  bits[25] = op;

  return bits;
}

describe('Wiegand bit parser', () => {
  it('returns null for wrong bit count', () => {
    expect(parseBits([0, 1, 0], 26)).toBeNull();
  });

  it('parses 26-bit frame facility=1 card=1234', () => {
    const bits   = makeWiegand26(1, 1234);
    const result = parseBits(bits, 26);
    expect(result).not.toBeNull();
    // Facility 1 = 0x0001, Card 1234 = 0x04D2 → hex 000104D2
    expect(result).toBe('000104D2');
  });

  it('parses 26-bit frame facility=100 card=9999', () => {
    const bits = makeWiegand26(100, 9999);
    const result = parseBits(bits, 26);
    expect(result).not.toBeNull();
  });

  it('parses 26-bit frame with facility=0 card=0', () => {
    const bits = makeWiegand26(0, 0);
    expect(parseBits(bits, 26)).toBe('00000000');
  });

  it('parses max 26-bit values (facility=255 card=65535)', () => {
    const bits = makeWiegand26(255, 65535);
    expect(parseBits(bits, 26)).toBe('00FFFFFF');
  });
});

describe('serial format parser', () => {
  function parseCardValue(raw: string, format: 'hex' | 'decimal' | 'ascii'): string | null {
    if (!raw) return null;
    switch (format) {
      case 'hex':
        return /^[0-9A-Fa-f\s]+$/.test(raw) ? raw.replace(/\s/g, '').toUpperCase() : null;
      case 'decimal': {
        const n = parseInt(raw, 10);
        return isNaN(n) ? null : n.toString(16).toUpperCase().padStart(8, '0');
      }
      case 'ascii':
      default: {
        const stripped = raw.replace(/^(CARD|UID|ID|TAG):/i, '').trim();
        if (!stripped) return null;
        return /^[0-9A-Fa-f]+$/.test(stripped) ? stripped.toUpperCase() : stripped;
      }
    }
  }

  it('parses hex format', () => {
    expect(parseCardValue('AABBCCDD', 'hex')).toBe('AABBCCDD');
    expect(parseCardValue('aa bb cc', 'hex')).toBe('AABBCC');
    expect(parseCardValue('ZZZZ',     'hex')).toBeNull();
  });

  it('parses decimal format', () => {
    expect(parseCardValue('255', 'decimal')).toBe('000000FF');
    expect(parseCardValue('0',   'decimal')).toBe('00000000');
    expect(parseCardValue('abc', 'decimal')).toBeNull();
  });

  it('parses ascii format with and without prefix', () => {
    expect(parseCardValue('AABBCCDD',      'ascii')).toBe('AABBCCDD');
    expect(parseCardValue('CARD:AABBCCDD', 'ascii')).toBe('AABBCCDD');
    expect(parseCardValue('UID:1122',      'ascii')).toBe('1122');
    expect(parseCardValue('',              'ascii')).toBeNull();
  });

  it('passes through QR string as-is', () => {
    const qr = 'MEMBER-UUID-1234-ABCD';
    expect(parseCardValue(qr, 'ascii')).toBe(qr);
  });
});
