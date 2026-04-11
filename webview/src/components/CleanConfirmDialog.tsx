import React, { useCallback, useMemo } from 'react';
import { useBoard } from '../context/BoardContext';
import { postMessage } from '../hooks/useVsCodeApi';

/** Provider IDs whose done tasks can be permanently deleted. */
const DELETABLE_PROVIDERS = ['json'];

export function CleanConfirmDialog() {
  const { state, dispatch } = useBoard();
  const { showCleanConfirm, tasks, columns, editableProviderIds } = state;

  const lastColId = columns[columns.length - 1]?.id;
  const doneTasks = useMemo(
    () => tasks.filter(t => t.status === lastColId),
    [tasks, lastColId],
  );

  const { toDelete, toHide } = useMemo(() => {
    const del = doneTasks.filter(t => DELETABLE_PROVIDERS.includes(t.providerId));
    const hide = doneTasks.filter(t => !DELETABLE_PROVIDERS.includes(t.providerId));
    return { toDelete: del, toHide: hide };
  }, [doneTasks]);

  const handleConfirm = useCallback(() => {
    postMessage({ type: 'cleanDone' });
    dispatch({ type: 'HIDE_CLEAN_CONFIRM' });
  }, [dispatch]);

  const handleCancel = useCallback(() => {
    dispatch({ type: 'HIDE_CLEAN_CONFIRM' });
  }, [dispatch]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('clean-confirm-overlay')) {
      dispatch({ type: 'HIDE_CLEAN_CONFIRM' });
    }
  }, [dispatch]);

  if (!showCleanConfirm) { return null; }

  if (doneTasks.length === 0) {
    return (
      <div className="clean-confirm-overlay" onClick={handleOverlayClick}>
        <div className="clean-confirm-panel">
          <div className="clean-confirm__heading">Clean Board</div>
          <p className="clean-confirm__text">No completed tasks to clean.</p>
          <div className="clean-confirm__actions">
            <button className="toolbar__btn toolbar__btn--secondary" onClick={handleCancel}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="clean-confirm-overlay" onClick={handleOverlayClick}>
      <div className="clean-confirm-panel">
        <div className="clean-confirm__heading">Clean Completed Tasks</div>
        <p className="clean-confirm__text">
          This will remove <strong>{doneTasks.length}</strong> task{doneTasks.length !== 1 ? 's' : ''} from the board:
        </p>

        {toDelete.length > 0 && (
          <div className="clean-confirm__section">
            <div className="clean-confirm__section-title clean-confirm__section-title--delete">
              ⊘ Permanently deleted ({toDelete.length})
            </div>
            <p className="clean-confirm__section-desc">
              These tasks are stored locally (JSON) and will be <strong>permanently deleted</strong> from disk.
            </p>
            <ul className="clean-confirm__list">
              {toDelete.map(t => (
                <li key={t.id} className="clean-confirm__item">
                  <span className="clean-confirm__item-title">{t.title}</span>
                  <span className="clean-confirm__item-provider">{t.providerId}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {toHide.length > 0 && (
          <div className="clean-confirm__section">
            <div className="clean-confirm__section-title clean-confirm__section-title--hide">
              ◇ Hidden from board ({toHide.length})
            </div>
            <p className="clean-confirm__section-desc">
              These tasks come from remote providers (GitHub, Azure DevOps, etc.). They will be <strong>hidden</strong> from the board
              but remain unchanged on the remote service — their status has already been synced.
            </p>
            <ul className="clean-confirm__list">
              {toHide.map(t => (
                <li key={t.id} className="clean-confirm__item">
                  <span className="clean-confirm__item-title">{t.title}</span>
                  <span className="clean-confirm__item-provider">{t.providerId}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="clean-confirm__actions">
          <button className="toolbar__btn toolbar__btn--primary clean-confirm__btn--confirm" onClick={handleConfirm}>
            Clean {doneTasks.length} task{doneTasks.length !== 1 ? 's' : ''}
          </button>
          <button className="toolbar__btn toolbar__btn--secondary" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
