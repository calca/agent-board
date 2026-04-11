import React, { useCallback, useMemo } from 'react';
import { useBoard } from '../context/BoardContext';
import { postMessage } from '../hooks/useVsCodeApi';

export function CleanConfirmDialog() {
  const { state, dispatch } = useBoard();
  const { showCleanConfirm, tasks, columns } = state;

  const lastColId = columns[columns.length - 1]?.id;
  const doneTasks = useMemo(
    () => tasks.filter(t => t.status === lastColId),
    [tasks, lastColId],
  );

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
          <div className="clean-confirm__heading">Hide Tasks</div>
          <p className="clean-confirm__text">No completed tasks to hide.</p>
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
        <div className="clean-confirm__heading">Hide Completed Tasks</div>
        <p className="clean-confirm__text">
          This will hide <strong>{doneTasks.length}</strong> task{doneTasks.length !== 1 ? 's' : ''} from the board:
        </p>

        <div className="clean-confirm__section">
          <div className="clean-confirm__section-title clean-confirm__section-title--hide">
            Hidden from board ({doneTasks.length})
          </div>
          <p className="clean-confirm__section-desc">
            Tasks will be <strong>hidden</strong> from the board but not deleted.
            Local tasks are marked as hidden on disk. Remote tasks are hidden from view
            but remain unchanged on the remote service.
          </p>
          <ul className="clean-confirm__list">
            {doneTasks.map(t => (
              <li key={t.id} className="clean-confirm__item">
                <span className="clean-confirm__item-title">{t.title}</span>
                <span className="clean-confirm__item-provider">{t.providerId}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="clean-confirm__actions">
          <button className="toolbar__btn toolbar__btn--primary clean-confirm__btn--confirm" onClick={handleConfirm}>
            Hide {doneTasks.length} task{doneTasks.length !== 1 ? 's' : ''}
          </button>
          <button className="toolbar__btn toolbar__btn--secondary" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}