import { useStore } from '../store/store';

// Shown only while the document is 'awaiting' review — i.e. the AI has pushed a
// version via requestReview and is parked on wait_for_review. The user leaves
// notes, then presses Submit review (send the open notes back as change requests)
// or Approve & continue (hand control back to the AI to finish its task).
export function ReviewBar() {
  const reviewState = useStore((s) => s.document?.reviewState);
  const notes = useStore((s) => s.notes);
  const submitReview = useStore((s) => s.submitReview);
  const approveReview = useStore((s) => s.approveReview);

  if (reviewState !== 'awaiting') return null;

  const openUserNotes = notes.filter((n) => n.author === 'user' && n.status === 'open').length;

  return (
    <div className="review-bar">
      <span className="review-bar-dot" aria-hidden />
      <span className="review-bar-msg">
        The AI is waiting for your review.
        {openUserNotes > 0
          ? ` ${openUserNotes} open note${openUserNotes === 1 ? '' : 's'} to send.`
          : ' Leave notes on the canvas, then submit — or approve to continue.'}
      </span>
      <div className="review-bar-actions">
        <button
          className="review-submit"
          disabled={openUserNotes === 0}
          title={openUserNotes === 0 ? 'Leave at least one note to request changes' : 'Send your notes to the AI'}
          onClick={() => submitReview()}
        >
          Submit review
        </button>
        <button className="review-approve" onClick={() => approveReview()}>
          Approve &amp; continue
        </button>
      </div>
    </div>
  );
}
