import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import UnderwritingPage from '../UnderwritingPage';
import { basicsSchema } from '../chat/basics';

function fillBasics() {
  fireEvent.change(screen.getByLabelText('Age'), { target: { value: '65' } });
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'TX' } });
  fireEvent.change(screen.getByLabelText('Height'), { target: { value: '66' } });
  fireEvent.change(screen.getByLabelText('Weight (lb)'), { target: { value: '170' } });
  fireEvent.change(screen.getByLabelText('Smoking / nicotine'), { target: { value: 'nonsmoker' } });
}
function send(text: string) {
  fireEvent.change(screen.getByLabelText('Health and medication notes'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send health note' }));
}
afterEach(() => { cleanup(); document.documentElement.classList.remove('dark'); });
describe('standalone AgentFlow dark chat', () => {
  it('starts empty, with brand logo, five basics and one chat box', () => {
    render(<UnderwritingPage />);
    expect(screen.getByAltText('AgentFlow')).toHaveAttribute('src', '/agentflow-logo-full-on-dark.png');
    expect(screen.getByLabelText('Age')).toHaveValue('');
    expect(screen.getByLabelText('Health and medication notes')).toHaveValue('');
    expect(screen.queryByRole('region', { name: 'Carrier results' })).not.toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    expect(document.title).toBe('Quick Underwriting | AgentFlow');
    expect(screen.queryByText('Commission reference')).not.toBeInTheDocument();
  });
  it('real Zod rejects invalid basics and extra identifiers', () => {
    expect(basicsSchema.safeParse({ age: 'no' }).success).toBe(false);
    render(<UnderwritingPage />); send('COPD');
    expect(screen.getByText('Complete the client basics first.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Carrier results' })).not.toBeInTheDocument();
  });
  it('uses the real parser and evaluator with no mocked carrier responses', () => {
    render(<UnderwritingPage />); fillBasics(); send('type 2 diabetes copd had cancer 7 years ago');
    expect(screen.getByRole('region', { name: 'Carrier results' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(document.querySelector('[data-question]')).toBeNull();
    expect(screen.queryByText('Cancer type and last treatment date could change the result.')).not.toBeInTheDocument();
    expect(document.querySelector('[data-carrier="transamerica"]')).toHaveAttribute('data-fit', 'yellow');
    expect(screen.queryByText('No name needed')).not.toBeInTheDocument();
    expect(screen.queryByText('Highest commission')).not.toBeInTheDocument();
  });
  it('requires confirmation before using a medication correction', () => {
    render(<UnderwritingPage />); fillBasics(); send('takes metfornin');
    expect(screen.getByText('“metfornin” — did you mean:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Metformin' }));
    expect(screen.queryByText('“metfornin” — did you mean:')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Metformin' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Diabetes' })).not.toBeInTheDocument();
  });
  it('resets all captured notes, basics and medication suggestions', () => {
    render(<UnderwritingPage />); fillBasics(); send('takes metfornin');
    fireEvent.click(screen.getByRole('button', { name: 'New case' }));
    expect(screen.getByLabelText('Age')).toHaveValue('');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText('“metfornin” — did you mean:')).not.toBeInTheDocument();
  });
  it('clears synchronously on pagehide and starts blank on pageshow', () => {
    render(<UnderwritingPage />); fillBasics(); send('COPD');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('pageshow')); });
    expect(screen.getByLabelText('Age')).toHaveValue('');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('restores the pre-existing document theme and title', () => {
    document.title = 'Original';
    const { unmount } = render(<UnderwritingPage />);
    unmount(); expect(document.title).toBe('Original'); expect(document.documentElement).not.toHaveClass('dark');
  });
  it('does not remove a dark theme that existed before mounting', () => {
    document.documentElement.classList.add('dark');
    const { unmount } = render(<UnderwritingPage />); unmount(); expect(document.documentElement).toHaveClass('dark');
  });
  it('keeps unknown text literal and never adds an injected image', () => {
    render(<UnderwritingPage />); fillBasics(); send('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });
  it('rejects obvious identifiers without saving the message', () => {
    render(<UnderwritingPage />); fillBasics(); send('test@example.invalid has COPD');
    expect(screen.getByText('Remove the client’s email, phone or identifying numbers. Health details only.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
  it('Shift+Enter does not submit but Enter does', () => {
    render(<UnderwritingPage />); fillBasics();
    const textarea = screen.getByLabelText('Health and medication notes');
    fireEvent.change(textarea, { target: { value: 'COPD' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true }); expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: 'Enter' }); expect(screen.getAllByRole('article')).toHaveLength(3);
  });
  it('composing text does not accidentally submit', () => {
    render(<UnderwritingPage />); fillBasics();
    const textarea = screen.getByLabelText('Health and medication notes');
    fireEvent.change(textarea, { target: { value: 'COPD' } });
    fireEvent.compositionStart(textarea); fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.compositionEnd(textarea); fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });
});

describe('instant stated-history review', () => {
  it('gets a source-supported screen without confirming other conditions', () => {
    render(<UnderwritingPage />); fillBasics(); send('COPD');
    expect(document.querySelector('[data-carrier="transamerica"]')).toHaveAttribute('data-fit', 'green');
    expect(document.querySelector('[data-question]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nothing else' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-assumption-notice]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove No oxygen/ })).not.toBeInTheDocument();
  });
  it('recognizes high blood pressure but does not fabricate control status', () => {
    render(<UnderwritingPage />); fillBasics(); send('high blood pressure');
    expect(screen.getByRole('button', { name: 'Remove High blood pressure' })).toBeInTheDocument();
    expect(screen.queryByText(/Unrecognized/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-carrier="transamerica"]')).toHaveAttribute('data-fit', 'yellow');
    send('blood pressure controlled');
    expect(document.querySelector('[data-carrier="transamerica"]')).toHaveAttribute('data-fit', 'green');
    expect(document.querySelector('[data-question]')).toBeNull();
  });
  it('offers a condition spelling suggestion without committing it', () => {
    render(<UnderwritingPage />); fillBasics(); send('controlled hypertention');
    expect(document.querySelector('[data-fit="green"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Did you mean High blood pressure?' }));
    expect(screen.getByRole('button', { name: 'Remove High blood pressure' })).toBeInTheDocument();
    expect(screen.queryByText(/Unrecognized/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-carrier="transamerica"]')).toHaveAttribute('data-fit', 'green');
  });
  it('edits unknown wording without offering a silent dismissal', () => {
    render(<UnderwritingPage />); fillBasics(); send('blood presure');
    expect(screen.queryByRole('button', { name: /Remove unmatched/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit wording: blood presure' }));
    expect(screen.getByRole('button', { name: 'Cancel edit' })).toBeInTheDocument();
    send('controlled hypertension');
    expect(screen.queryByText(/Unrecognized/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-carrier="transamerica"]')).toHaveAttribute('data-fit', 'green');
  });
  it('retains an unknown condition beside COPD; new facts cannot clear it', () => {
    render(<UnderwritingPage />); fillBasics(); send('COPD and zorb syndrome');
    expect(document.querySelector('[data-fit="green"]')).toBeNull();
    send('blood pressure controlled');
    expect(document.querySelector('[data-fit="green"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit wording: COPD and zorb syndrome' })).toBeInTheDocument();
  });
  it('new oxygen information overrides the omission assumption immediately', () => {
    render(<UnderwritingPage />); fillBasics(); send('COPD');
    send('on oxygen');
    expect(document.querySelector('[data-carrier="americo"]')).toHaveAttribute('data-fit', 'red');
    expect(document.querySelector('[data-fit="green"]')).toBeNull();
  });
  it('does not anchor an unqualified duration to an invisible cancer question', () => {
    render(<UnderwritingPage />); fillBasics(); send('cancer'); send('7 years ago');
    expect(screen.queryByRole('button', { name: /Remove Cancer treatment complete/ })).not.toBeInTheDocument();
    expect(document.querySelector('[data-fit="green"]')).toBeNull();
  });
  it('clears an unfinished wording correction on New case', () => {
    render(<UnderwritingPage />); fillBasics(); send('zorb syndrome');
    fireEvent.click(screen.getByRole('button', { name: 'Edit wording: zorb syndrome' }));
    fireEvent.click(screen.getByRole('button', { name: 'New case' }));
    expect(screen.queryByRole('button', { name: 'Cancel edit' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Health and medication notes')).toHaveValue('');
  });
});

describe('minimal internal-agent presentation', () => {
  it('removes competing introduction, Why, About, footer and commission placeholders', () => {
    render(<UnderwritingPage />);
    expect(screen.queryByText('No name needed')).not.toBeInTheDocument();
    expect(screen.queryByText(/The basics\. A few health/)).not.toBeInTheDocument();
    fillBasics(); send('healthy');
    expect(document.querySelectorAll('[data-fit="green"]')).toHaveLength(3);
    expect(document.querySelector('footer')).toBeNull();
    expect(document.querySelector('[data-assumption-notice]')).toBeNull();
    expect(screen.queryByText('Why?')).not.toBeInTheDocument();
    expect(screen.queryByText('About this quick screen')).not.toBeInTheDocument();
    expect(screen.queryByText(/Private session|Not an approval|Tier to confirm|Commission order is pending/)).not.toBeInTheDocument();
    for (const card of screen.getAllByRole('article')) {
      expect(card.querySelector('details')).toBeNull();
      expect(card.querySelector('a')).toBeNull();
      expect(card.textContent!.length).toBeLessThan(120);
    }
  });
  it('keeps a condition medication case useful without displaying the evaluator log', () => {
    render(<UnderwritingPage />); fillBasics(); send('type 2 diabetes metformin');
    expect(document.querySelector('[data-carrier="transamerica"]')).toHaveAttribute('data-fit', 'green');
    expect(document.querySelector('[data-carrier="americo"]')).toHaveAttribute('data-fit', 'green');
    expect(screen.queryByText(/Carrier-level placement from supported/)).not.toBeInTheDocument();
    expect(document.querySelector('[data-question]')).toBeNull();
  });
  it('retains a compact medication correction only when a spelling actually needs it', () => {
    render(<UnderwritingPage />); fillBasics(); send('diabetes takes metfornin');
    expect(screen.getByRole('button', { name: 'Metformin' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Metformin' }));
    expect(screen.queryByText('“metfornin” — did you mean:')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm the actual medication. No diagnosis is inferred.')).not.toBeInTheDocument();
    expect(document.querySelector('[data-carrier="transamerica"]')).toHaveAttribute('data-fit', 'green');
  });
  it('preserves necessary status text beside colors', () => {
    render(<UnderwritingPage />); fillBasics(); send('Parkinsons');
    expect(screen.getByText('Likely fit')).toBeInTheDocument();
    expect(screen.getByText('Possible fit')).toBeInTheDocument();
    expect(screen.getByText('Likely decline')).toBeInTheDocument();
  });
});
