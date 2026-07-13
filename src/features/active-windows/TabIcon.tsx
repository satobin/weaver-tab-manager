import { Globe2, SquarePlus } from 'lucide-react';
import { useState } from 'react';

interface TabIconProps {
  fallback?: 'page' | 'new-tab';
  iconUrl: string | null;
  size?: number;
}

export function TabIcon({ fallback = 'page', iconUrl, size = 16 }: TabIconProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const FallbackIcon = fallback === 'new-tab' ? SquarePlus : Globe2;

  return iconUrl && failedUrl !== iconUrl ? (
    <img
      className="tab-favicon"
      src={iconUrl}
      alt=""
      width={size}
      height={size}
      onError={() => setFailedUrl(iconUrl)}
    />
  ) : (
    <FallbackIcon className="tab-favicon tab-favicon-fallback" aria-hidden="true" size={size} />
  );
}
