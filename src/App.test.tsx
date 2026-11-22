import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { parse } from './lib/vtt';

describe('CaptionCheck workflow', () => {
  it('lists problems in the demo file and filters by cue', async () => {
    window.location.hash = '/check';
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText(/SubRip style/)).toBeInTheDocument();
    expect(screen.getByText(/Overlaps the previous cue/)).toBeInTheDocument();
    await user.click(screen.getByRole('listitem', { name: /Cue 4,/ }));
    expect(screen.getByText(/Showing cue 4 only/)).toBeInTheDocument();
    expect(screen.getByText(/ends .* before or when it starts/)).toBeInTheDocument();
  });

  it('shows a corrected file that parses without errors', async () => {
    window.location.hash = '/check';
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('radio', { name: 'Corrected' }));
    const fixed = screen.getByTestId('fixed').textContent!;
    expect(parse(fixed).problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(screen.getByText(/Trimmed cue 1/)).toBeInTheDocument();
  });

  it('reports a clean file and handles uploads and the empty state', async () => {
    window.location.hash = '/check';
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Demo: clean' }));
    expect(screen.getByText(/No problems found/)).toBeInTheDocument();
    fireEvent.change(document.getElementById('vtt')!, { target: { files: [new File(['WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi'], 'tiny.vtt')] } });
    await waitFor(() => expect(screen.getByText('Loaded tiny.vtt.')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Caption text'), { target: { value: '' } });
    expect(screen.getByText('Paste or open a caption file')).toBeInTheDocument();
  });
});
