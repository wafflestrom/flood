import {FC, useRef} from 'react';

import {DiskFlat} from '@client/ui/icons';
import UIStore from '@client/stores/UIStore';

import Tooltip, {TooltipHandle} from '../general/Tooltip';

const StocktakeButton: FC = () => {
  const tooltipRef = useRef<TooltipHandle>(null);

  return (
    <Tooltip
      content="Stocktake"
      onClick={() => {
        if (tooltipRef.current != null) {
          tooltipRef.current.dismissTooltip();
        }

        UIStore.setActiveModal({id: 'stocktake'});
      }}
      ref={tooltipRef}
      position="bottom"
      wrapperClassName="sidebar__action sidebar__icon-button
          sidebar__icon-button--interactive tooltip__wrapper"
    >
      <DiskFlat />
    </Tooltip>
  );
};

export default StocktakeButton;
