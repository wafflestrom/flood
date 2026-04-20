import {FC} from 'react';
import {observer} from 'mobx-react-lite';
import {useLingui} from '@lingui/react';

import TorrentFilterStore from '@client/stores/TorrentFilterStore';
import TorrentStore from '@client/stores/TorrentStore';

import Badge from '../general/Badge';

const ResetFiltersButton: FC = observer(() => {
  const {i18n} = useLingui();

  if (!TorrentFilterStore.isFilterActive) {
    return null;
  }

  const filteredCount = TorrentStore.filteredTorrents.length;
  const totalCount = Object.keys(TorrentStore.torrents).length;

  return (
    <ul className="sidebar-filter sidebar__item sidebar-filter--reset" role="menu">
      <li className="sidebar-filter__item" role="none">
        <button
          className="sidebar-filter__item sidebar-filter__item--reset"
          type="button"
          onClick={() => TorrentFilterStore.clearAllFilters()}
          role="menuitem"
        >
          <span className="name">{i18n._('filter.reset')}</span>
          <Badge>
            {filteredCount} / {totalCount}
          </Badge>
        </button>
      </li>
    </ul>
  );
});

export default ResetFiltersButton;
