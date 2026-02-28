import { useState } from 'react';
import { X, Trash2, UtensilsCrossed, Loader2, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { mealLabel } from './MealTypeSelector';

interface MealTemplate {
  id: string;
  template_name: string;
  meal_type: string | null;
  total_calories: number;
  total_protein: number;
  total_carbohydrate: number;
  total_fat: number;
  log_count: number;
}

export default function MealTemplatesSheet({
  templates,
  mealType,
  dateStr,
  onClose,
  onLogged,
  onTemplatesChanged,
  onOpenBuilder,
}: {
  templates: MealTemplate[];
  mealType: string;
  dateStr: string;
  onClose: () => void;
  onLogged: () => void;
  onTemplatesChanged: () => void;
  onOpenBuilder?: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedItems([]);
      return;
    }

    setExpandedId(id);
    setLoadingItems(true);
    try {
      const { data } = await supabase
        .from('meal_template_items')
        .select('*')
        .eq('meal_template_id', id)
        .order('sort_order', { ascending: true });
      setExpandedItems(data || []);
    } catch {
      setExpandedItems([]);
    }
    setLoadingItems(false);
  };

  const handleLog = async (template: MealTemplate) => {
    setLoggingId(template.id);
    setError('');

    try {
      // Fetch items if not already loaded
      let items = expandedId === template.id ? expandedItems : [];
      if (items.length === 0) {
        const { data } = await supabase
          .from('meal_template_items')
          .select('*')
          .eq('meal_template_id', template.id)
          .order('sort_order', { ascending: true });
        items = data || [];
      }

      if (items.length === 0) {
        setError('No items in this template');
        setLoggingId(null);
        return;
      }

      // Log each item
      const results = await Promise.all(
        items.map((item: any) =>
          supabase.functions.invoke('food-log', {
            body: {
              food_id: item.food_id,
              food_name: item.food_name,
              serving_id: item.serving_id || '0',
              serving_description: item.serving_description || '',
              number_of_units: item.number_of_units || 1,
              calories: item.calories || 0,
              protein: item.protein || 0,
              carbohydrate: item.carbohydrate || 0,
              fat: item.fat || 0,
              fiber: item.fiber || 0,
              sugar: item.sugar || 0,
              sodium: item.sodium || 0,
              meal_type: mealType,
              logged_at: new Date(dateStr + 'T12:00:00.000Z').toISOString(),
            },
          })
        )
      );

      const failed = results.filter(r => r.error);
      if (failed.length > 0) {
        setError(`Failed to log ${failed.length} item(s)`);
        setLoggingId(null);
      } else {
        // Update template log count
        await supabase
          .from('meal_templates')
          .update({ log_count: (template.log_count || 0) + 1, last_logged_at: new Date().toISOString() })
          .eq('id', template.id);
        onLogged();
      }
    } catch (e: any) {
      setError(`Failed to log meal: ${e.message || 'Network error'}`);
      setLoggingId(null);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await supabase.functions.invoke('favorites-manage', {
        body: { action: 'delete_meal_template', id },
      });
      onTemplatesChanged();
    } catch {
      // ignore
    }
    setDeletingId(null);
  };

  return (
    <div className="nutrition-overlay">
      <div className="nutrition-overlay-header">
        <button className="menu-btn" onClick={onClose}><X size={20} /></button>
        <h2>Meal Templates</h2>
      </div>

      <div className="nutrition-overlay-body">
        {error && (
          <p style={{ color: 'var(--accent)', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</p>
        )}

        {templates.length === 0 ? (
          <div className="nutrition-empty">
            <UtensilsCrossed size={32} />
            <div className="nutrition-empty-title">No meal templates yet</div>
            <div className="nutrition-empty-desc">
              Save combinations of foods as templates to log entire meals with one tap.
            </div>
            {onOpenBuilder && (
              <button className="engine-btn engine-btn-primary" style={{ marginTop: 8 }} onClick={onOpenBuilder}>
                <Plus size={16} /> Build a Meal
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {onOpenBuilder && (
              <button className="engine-btn engine-btn-secondary" style={{ width: '100%', marginBottom: 4 }} onClick={onOpenBuilder}>
                <Plus size={16} /> Build New Template
              </button>
            )}
            {templates.map(template => (
              <div key={template.id} className="nutrition-template-card" style={{ cursor: 'default' }}>
                <div
                  style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, cursor: 'pointer' }}
                  onClick={() => toggleExpand(template.id)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nutrition-template-name">{template.template_name}</div>
                    <div className="nutrition-template-meta">
                      {template.meal_type ? mealLabel(template.meal_type) : 'Any meal'}
                      {template.log_count > 0 && ` · Logged ${template.log_count}x`}
                    </div>
                    <div className="nutrition-template-macros">
                      <span>{Math.round(template.total_calories)} cal</span>
                      <span>{Math.round(template.total_protein)}g P</span>
                      <span>{Math.round(template.total_carbohydrate)}g C</span>
                      <span>{Math.round(template.total_fat)}g F</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                    <button
                      onClick={(e) => handleDelete(template.id, e)}
                      disabled={deletingId === template.id}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, opacity: deletingId === template.id ? 0.5 : 1 }}
                    >
                      <Trash2 size={16} />
                    </button>
                    {expandedId === template.id ? <ChevronUp size={18} color="var(--text-dim)" /> : <ChevronDown size={18} color="var(--text-dim)" />}
                  </div>
                </div>

                {/* Expanded items */}
                {expandedId === template.id && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    {loadingItems ? (
                      <div style={{ textAlign: 'center', padding: 12, color: 'var(--text-dim)' }}>
                        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                      </div>
                    ) : expandedItems.length === 0 ? (
                      <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>No items</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                        {expandedItems.map((item: any) => (
                          <div key={item.id} className="nutrition-builder-item">
                            <span className="nutrition-builder-item-name">{item.food_name}</span>
                            <span className="nutrition-builder-item-macros">
                              {item.number_of_units}x · {Math.round(item.calories)} cal
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      className="engine-btn engine-btn-primary"
                      style={{ width: '100%' }}
                      onClick={() => handleLog(template)}
                      disabled={loggingId === template.id}
                    >
                      {loggingId === template.id ? (
                        <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Logging...</>
                      ) : (
                        `Log This Meal — ${Math.round(template.total_calories)} cal`
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
