export const C = {
  bg:       '#05050A',
  surface:  'rgba(255,255,255,0.05)',
  border:   'rgba(255,255,255,0.08)',
  primary:  '#7C3AED',
  accent:   '#22D3EE',
  success:  '#10B981',
  warning:  '#F59E0B',
  danger:   '#F87171',
  text:     '#F1F5F9',
  textSub:  '#94A3B8',
  muted:    '#64748B',
  dimmed:   '#475569',
} as const;

export const GRAD: [string, string] = ['#7C3AED', '#22D3EE'];
export const GRAD_SUCCESS: [string, string] = ['#059669', '#10B981'];
export const GRAD_DANGER:  [string, string] = ['#DC2626', '#EF4444'];

export const S = {
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800' as const,
    letterSpacing: -0.3,
    color: C.text,
    marginBottom: 10,
  },
  label: {
    fontSize: 10,
    fontWeight: '600' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    color: C.muted,
  },
} as const;
