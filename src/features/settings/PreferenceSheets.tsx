import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { useApp } from '../../app/context';
import { setSetting } from '../../storage/db';
import { Sheet } from '../../shared/Sheet';
import { ActionButton } from '../../shared/ActionButton';

export function PreferencesSheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [draft, setDraft] = useState(structuredClone(app.data.preferences));
  return (
    <Sheet title="通用设置" onClose={onClose}>
      <div className="form-stack">
        <label>
          忌口与过敏
          <textarea
            data-autofocus
            aria-label="忌口与过敏"
            value={draft.avoidances}
            onChange={(e) => setDraft({ ...draft, avoidances: e.target.value })}
            maxLength={1000}
            placeholder="例如：花生过敏、不吃香菜"
          />
        </label>
        <label>
          口味
          <textarea
            aria-label="口味"
            value={draft.taste}
            onChange={(e) => setDraft({ ...draft, taste: e.target.value })}
            maxLength={1000}
            placeholder="例如：清淡、少辣"
          />
        </label>
        <fieldset>
          <legend>锅具</legend>
          <div className="cookware-options">
            {['炒锅', '平底锅', '汤锅', '蒸锅', '电饭煲', '烤箱'].map((tool) => (
              <label key={tool} className={draft.cookware.includes(tool) ? 'selected' : ''}>
                <input
                  type="checkbox"
                  checked={draft.cookware.includes(tool)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cookware: e.target.checked
                        ? [...draft.cookware, tool]
                        : draft.cookware.filter((t) => t !== tool),
                    })
                  }
                />
                {tool}
              </label>
            ))}
          </div>
        </fieldset>
        <ActionButton
          className="primary wide"
          pendingLabel="正在保存…"
          success="通用设置已保存"
          action={async () => {
            await setSetting('preferences', draft);
            onClose();
          }}
        >
          保存设置
        </ActionButton>
        <button className="secondary wide" onClick={onClose}>
          取消
        </button>
      </div>
    </Sheet>
  );
}
export function ModelSwitch({ onClose }: { onClose: () => void }) {
  const app = useApp();
  return (
    <Sheet title="选择模型" onClose={onClose}>
      {app.data.models.map((model) => (
        <ActionButton
          className="model-option"
          key={model.id}
          aria-pressed={app.data.activeModelId === model.id}
          pendingLabel="正在切换…"
          success={`已切换至${model.name}`}
          action={async () => {
            await setSetting('activeModelId', model.id);
            onClose();
          }}
        >
          <span>
            <strong>{model.name}</strong>
            <small>{model.model}</small>
          </span>
          {app.data.activeModelId === model.id && <Check size={19} />}
        </ActionButton>
      ))}
      <button
        className="secondary wide"
        onClick={() => {
          onClose();
          void app.navigate({ page: 'settings' });
        }}
      >
        <Plus size={16} />
        管理模型配置
      </button>
    </Sheet>
  );
}
