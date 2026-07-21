import type { ItemCategory } from '../types';
import { CATEGORY_LABELS } from '../types';

type Props = {
  category: ItemCategory;
  size?: number;
};

const PATHS: Record<ItemCategory, JSX.Element> = {
  umbrella: (
    <>
      <path d="M12 3C7 3 3.5 6.5 3 11h18c-.5-4.5-4-8-9-8Z" />
      <path d="M12 11v7a2 2 0 0 0 4 0" />
      <path d="M12 3v2" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  watch: (
    <>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 9.5V12l2 1.5" />
      <path d="M9.5 6.5 10 3h4l.5 3.5M9.5 17.5 10 21h4l.5-3.5" />
    </>
  ),
  audio: (
    <>
      <path d="M4 14a8 8 0 0 1 16 0" />
      <rect x="3" y="14" width="4" height="6" rx="1.5" />
      <rect x="17" y="14" width="4" height="6" rx="1.5" />
    </>
  ),
  bicycle: (
    <>
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
      <path d="M6 16 9.5 9h5L18 16M9.5 9 8 6h2.5M14.5 9l-3 5.5h-5" />
    </>
  ),
  bag: (
    <>
      <rect x="5" y="8" width="14" height="12" rx="2.5" />
      <path d="M9 8V6.5A2.5 2.5 0 0 1 11.5 4h1A2.5 2.5 0 0 1 15 6.5V8" />
      <path d="M9 12v1.5M15 12v1.5" />
    </>
  ),
  clothing: (
    <>
      <path d="m8 4-4.5 3L6 10.5 8 9v11h8V9l2 1.5L20.5 7 16 4a4 4 0 0 1-8 0Z" />
    </>
  ),
  accessory: (
    <>
      <path d="M7 3h10l4 6-9 12L3 9l4-6Z" />
      <path d="M3 9h18M12 21 8.5 9l2-6M12 21 15.5 9l-2-6" />
    </>
  ),
  book: (
    <>
      <path d="M12 6c-1.8-1.4-4.2-2-8-2v14c3.8 0 6.2.6 8 2 1.8-1.4 4.2-2 8-2V4c-3.8 0-6.2.6-8 2Z" />
      <path d="M12 6v14" />
    </>
  ),
};

export const CategoryIcon = ({ category, size = 48 }: Props): JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-label={CATEGORY_LABELS[category]}
  >
    {PATHS[category]}
  </svg>
);
