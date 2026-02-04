import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('Settings Feature', () => {
  it('should render settings button in header', () => {
    render(<App />);

    const settingsButton = screen.getByRole('button', { name: /설정/i });
    expect(settingsButton).toBeInTheDocument();
  });

  it('should open modal when settings button is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);

    const settingsButton = screen.getByRole('button', { name: /설정/i });
    await user.click(settingsButton);

    const modal = screen.getByRole('dialog');
    expect(modal).toBeInTheDocument();
  });

  it('should render settings modal with title', async () => {
    const user = userEvent.setup();
    render(<App />);

    const settingsButton = screen.getByRole('button', { name: /설정/i });
    await user.click(settingsButton);

    const modalTitle = screen.getByRole('heading', { name: /설정/i });
    expect(modalTitle).toBeInTheDocument();
  });

  it('should close modal when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);

    const settingsButton = screen.getByRole('button', { name: /설정/i });
    await user.click(settingsButton);

    const modal = screen.getByRole('dialog');
    expect(modal).toBeInTheDocument();

    const closeButton = screen.getByRole('button', { name: /닫기/i });
    await user.click(closeButton);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
