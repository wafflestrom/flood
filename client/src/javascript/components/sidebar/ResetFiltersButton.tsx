import {FC} from 'react';
import {observer} from 'mobx-react-lite';
import {useLingui} from '@lingui/react';

import {css} from '@client/styled-system/css';
import TorrentFilterStore from '@client/stores/TorrentFilterStore';

const resetButtonStyle = css({
  cursor: 'pointer',
  fontSize: '0.8em',
  fontWeight: 500,
  padding: '6px 20px',
  textAlign: 'start',
  width: '100%',
  opacity: 0.7,
  transition: 'opacity 0.15s',
  _hover: {
    opacity: 1,
  },
});

const ResetFiltersButton: FC = observer(() => {
  const {i18n} = useLingui();

  if (!TorrentFilterStore.isFilterActive) {
    return null;
  }

  return (
    <button
      className={resetButtonStyle}
      type="button"
      onClick={() => TorrentFilterStore.clearAllFilters()}
      aria-label={i18n._('filter.reset')}
    >
      {i18n._('filter.reset')}
    </button>
  );
});

export default ResetFiltersButton;
