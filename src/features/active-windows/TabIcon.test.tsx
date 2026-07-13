import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TabIcon } from './TabIcon';

describe('TabIcon', () => {
  it('uses SquarePlus for a New Tab without a favicon', () => {
    const { container } = render(<TabIcon fallback="new-tab" iconUrl={null} />);

    expect(container.querySelector('.lucide-square-plus')).toBeInTheDocument();
    expect(container.querySelector('.lucide-earth')).not.toBeInTheDocument();
  });

  it('retains the neutral globe for other missing favicons', () => {
    const { container } = render(<TabIcon iconUrl={null} />);

    expect(container.querySelector('.lucide-earth')).toBeInTheDocument();
    expect(container.querySelector('.lucide-square-plus')).not.toBeInTheDocument();
  });

  it('uses the selected fallback when a favicon fails to load', () => {
    const { container } = render(
      <TabIcon fallback="new-tab" iconUrl="https://example.test/favicon.png" />,
    );
    const image = container.querySelector('img');

    expect(image).not.toBeNull();
    fireEvent.error(image as HTMLImageElement);
    expect(container.querySelector('.lucide-square-plus')).toBeInTheDocument();
  });
});
