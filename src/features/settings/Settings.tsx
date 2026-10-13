import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import { useApp } from '../../app/context';
import { db, setSetting } from '../../storage/db';
import { clearData, deleteModel, exportData, saveModel } from '../../storage/repository';
import { testConnection } from '../../services/ai/client';
import { DEEPSEEK_MODELS, DEEPSEEK_URL, isDeepSeek } from '../../services/ai/providers';
import { uid, type ModelConfig } from '../../domain/schema';
import { Sheet } from '../../shared/Sheet';
import { PageHeader } from '../recipes/RecipePages';

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
        <button
          className="primary wide"
          onClick={() => {
            void app.safe(async () => {
              await setSetting('preferences', draft);
              onClose();
            }, '通用设置已保存');
          }}
        >
          保存设置
        </button>
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
        <button
          className="model-option"
          key={model.id}
          onClick={() => {
            void app.safe(async () => {
              await setSetting('activeModelId', model.id);
              onClose();
            });
          }}
        >
          <span>
            <strong>{model.name}</strong>
            <small>{model.model}</small>
          </span>
          {app.data.activeModelId === model.id && <Check size={19} />}
        </button>
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
function ModelEditor({ initial, onClose }: { initial?: ModelConfig; onClose: () => void }) {
  const app = useApp();
  const [draft, setDraft] = useState<ModelConfig>(
    initial ?? {
      id: uid(),
      ...DEEPSEEK_MODELS[0],
      url: DEEPSEEK_URL,
    },
  );
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState('');
  const [loaded, setLoaded] = useState(!initial);
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    if (initial)
      void db.credentials
        .get(initial.id)
        .then((value) => {
          if (active) {
            setKey(value?.key ?? '');
            setLoaded(true);
          }
        })
        .catch(() => app.notify('无法读取凭据，请重试'));
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [initial, app.notify]);
  const change = (field: keyof ModelConfig, value: string) => {
    setDraft({ ...draft, [field]: value });
    setResult('');
  };
  return (
    <Sheet title={initial ? '编辑模型' : '添加模型'} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          void app
            .safe(async () => {
              await saveModel(draft, key);
              onClose();
            }, '模型配置已保存')
            .finally(() => setSaving(false));
        }}
      >
        <label>
          快速配置
          <select
            aria-label="快速配置"
            value={
              isDeepSeek(draft.url) && DEEPSEEK_MODELS.some((m) => m.model === draft.model)
                ? draft.model
                : ''
            }
            onChange={(e) => {
              const preset = DEEPSEEK_MODELS.find((m) => m.model === e.target.value);
              if (preset) {
                setDraft({ ...draft, ...preset, url: DEEPSEEK_URL });
                setResult('');
              } else change('model', '');
            }}
          >
            <option value="">自定义兼容接口</option>
            {DEEPSEEK_MODELS.map((preset) => (
              <option key={preset.model} value={preset.model}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          配置名称
          <input
            data-autofocus
            aria-label="配置名称"
            required
            maxLength={100}
            value={draft.name}
            onChange={(e) => change('name', e.target.value)}
          />
        </label>
        <label>
          接口地址
          <input
            aria-label="接口地址"
            type="url"
            required
            value={draft.url}
            onChange={(e) => change('url', e.target.value)}
          />
        </label>
        <label>
          API Key
          <div className="secret-field">
            <input
              aria-label="API Key"
              type={visible ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              disabled={!loaded}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                setResult('');
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={visible ? '隐藏 API Key' : '显示 API Key'}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </label>
        <label>
          模型名称
          <input
            aria-label="模型名称"
            required
            maxLength={200}
            value={draft.model}
            onChange={(e) => change('model', e.target.value)}
          />
        </label>
        <p className="small muted">
          Key 保存在此浏览器，请求直接发送至配置的模型服务。导出数据不包含 Key。
        </p>
        <button
          className="secondary wide"
          type="button"
          disabled={testing || !loaded || !draft.url.trim() || !draft.model.trim()}
          onClick={() => {
            setTesting(true);
            setResult('');
            controller.current = new AbortController();
            void testConnection({ ...draft, key }, controller.current.signal)
              .then((answer) => setResult(`连接成功 · ${answer}`))
              .catch((error) => {
                if (error.name !== 'AbortError') setResult(error.message);
              })
              .finally(() => setTesting(false));
          }}
        >
          {testing ? (
            <>
              <LoaderCircle size={16} className="spin" />
              测试连接中…
            </>
          ) : (
            '测试连接'
          )}
        </button>
        {result && (
          <p
            className={`test-result ${result.startsWith('连接成功') ? 'success' : 'warning'}`}
            role="status"
          >
            {result}
          </p>
        )}
        <button className="primary wide" disabled={!loaded || saving}>
          保存模型
        </button>
        <button className="secondary wide" type="button" onClick={onClose}>
          取消
        </button>
      </form>
    </Sheet>
  );
}
export function Settings() {
  const app = useApp();
  const [editor, setEditor] = useState<ModelConfig | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ModelConfig | null>(null);
  const [clear, setClear] = useState(false);
  const [persistent, setPersistent] = useState<string>('');
  const download = async () => {
    const text = await exportData();
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `CookPilot-${new Date().toLocaleDateString('sv-SE')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <PageHeader title="我的厨房" />
      <main className="page settings-page">
        <section>
          <div className="section-heading">
            <h2>模型配置</h2>
            <button className="text-button" onClick={() => setEditor('new')}>
              <Plus size={16} />
              添加
            </button>
          </div>
          {!app.data.models.length && (
            <button className="empty-model" onClick={() => setEditor('new')}>
              <Plus size={20} />
              添加你的第一个模型
            </button>
          )}
          {app.data.models.map((model) => (
            <article className="model-card" key={model.id}>
              <div className="model-card-head">
                <button
                  className="model-select"
                  aria-label={`使用${model.name}`}
                  onClick={() => {
                    void app.safe(() => setSetting('activeModelId', model.id));
                  }}
                >
                  <span
                    className={`radio ${app.data.activeModelId === model.id ? 'selected' : ''}`}
                  />
                  <strong>{model.name}</strong>
                </button>
                <button className="text-button" onClick={() => setEditor(model)}>
                  编辑
                </button>
                <button
                  className="icon-button muted"
                  aria-label={`删除模型${model.name}`}
                  onClick={() => setDeleting(model)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <p className="small muted model-detail">{model.model}</p>
              <p className="small muted model-detail truncate">{model.url}</p>
            </article>
          ))}
        </section>
        <section>
          <h2>本机数据</h2>
          <p className="small muted settings-description">
            菜谱、对话和心得保存在当前浏览器。定期导出一份备份。
          </p>
          <button
            className="settings-row"
            onClick={() => {
              void app.safe(download, '已导出脱敏数据');
            }}
          >
            <ArrowDownToLine size={19} />
            <span>导出数据 JSON</span>
            <ChevronRight size={17} />
          </button>
          <button
            className="settings-row"
            onClick={() => {
              void app.safe(async () => {
                const granted = await navigator.storage?.persist?.();
                setPersistent(granted ? '已获准保留本机存储' : '浏览器暂未批准；请定期导出备份');
              });
            }}
          >
            <span>申请保留本机存储</span>
            <ChevronRight size={17} />
          </button>
          {persistent && <p className="small muted">{persistent}</p>}
          <button className="settings-row danger-text" onClick={() => setClear(true)}>
            <Trash2 size={18} />
            <span>清除全部本地数据</span>
            <ChevronRight size={17} />
          </button>
        </section>
        <p className="app-version">CookPilot 1.0 · 在自己的厨房里</p>
      </main>
      {editor && (
        <ModelEditor
          initial={editor === 'new' ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}{' '}
      {deleting && (
        <Sheet title="删除模型配置？" onClose={() => setDeleting(null)}>
          <p>删除「{deleting.name}」及其本机 Key，已保存菜谱仍可使用。</p>
          <button
            className="danger wide"
            onClick={() => {
              void app.safe(async () => {
                await deleteModel(deleting.id);
                setDeleting(null);
              }, '模型已删除');
            }}
          >
            确认删除
          </button>
          <button className="secondary wide" onClick={() => setDeleting(null)}>
            取消
          </button>
        </Sheet>
      )}
      {clear && (
        <Sheet title="清除全部本地数据？" onClose={() => setClear(false)}>
          <p>所有用户菜谱、制作记录、心得、计时、对话、偏好和模型 Key 都会删除。请先导出备份。</p>
          <button
            className="danger wide"
            onClick={() => {
              void app.safe(async () => {
                await app.cancel();
                await clearData();
                setClear(false);
                await app.navigate({ page: 'home' });
              }, '本地数据已清除');
            }}
          >
            确认清除全部数据
          </button>
          <button className="secondary wide" onClick={() => setClear(false)}>
            取消
          </button>
        </Sheet>
      )}
    </>
  );
}
