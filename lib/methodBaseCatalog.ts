import { getAllTests } from '@/lib/loadTests';
import type { AnyTest } from '@/lib/testTypes';

export type MethodResultOption = {
  key: string;
  label: string;
  group?: string;
  suggestedValues: string[];
};

export type MethodCatalogTest = {
  slug: string;
  title: string;
  resultOptions: MethodResultOption[];
};

function uniq(values: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function option(key: string, label: string, suggestedValues: string[], group?: string): MethodResultOption {
  return { key, label, group, suggestedValues: uniq(suggestedValues) };
}

function buildResultOptions(test: AnyTest): MethodResultOption[] {
  const scoring: any = (test as any)?.scoring || {};
  switch (test.slug) {
    case 'situational-guidance': {
      const styles = Object.entries(scoring.style_to_name || {}).map(([key, label]) =>
        option(String(key), String(label), ['ведущий', 'выражен', 'ослаблен'], 'Стили')
      );
      return [
        ...styles,
        option('flexibility', 'Гибкость стиля', ['низкая', 'средняя', 'высокая'], 'Итоговые показатели'),
        option('adequacy', 'Адекватность стиля', ['низкая', 'средняя', 'высокая'], 'Итоговые показатели'),
        option('polarity', 'Полярность распределения стилей', ['выражена', 'умеренная', 'не выражена'], 'Итоговые показатели'),
      ];
    }
    case 'emin': {
      const labels = Object.entries(scoring.scale_to_name || {}).map(([key, label]) => {
        const norms = Array.isArray(scoring.norms?.[key]) ? scoring.norms[key] : [];
        const suggested = norms.map((x: any) => x?.label).filter(Boolean);
        return option(String(key), String(label), suggested.length ? suggested : ['низкий', 'средний', 'высокий'], 'Шкалы ЭМИН');
      });
      return labels;
    }
    case 'usk':
      return Object.entries(scoring.scale_to_name || {}).map(([key, label]) =>
        option(String(key), String(label), ['низкий', 'средний', 'высокий'], 'Шкалы УСК')
      );
    case 'belbin':
      return Object.entries(scoring.role_to_name || {}).map(([key, label]) =>
        option(String(key), String(label), ['сильная роль', 'заметная роль', 'слабая роль'], 'Командные роли')
      );
    case 'time-management':
      return Object.entries(scoring.tag_to_name || {}).map(([key, label]) =>
        option(String(key), String(label), ['ведущий', 'заметный', 'слабый'], 'Типы восприятия времени')
      );
    case 'learning-typology':
      return Object.entries(scoring.tag_to_name || {}).map(([key, label]) =>
        option(String(key), String(label), ['доминирующий', 'выраженный', 'слабый'], 'Стили обучения')
      );
    case 'motivation-cards':
      return Object.entries(scoring.factor_to_name || {}).map(([key, label]) =>
        option(String(key), String(label), ['ведущий мотив', 'значимый мотив', 'ослабленный мотив'], 'Мотиваторы')
      );
    case '16pf-a':
      return Object.entries(scoring.factor_to_name || {}).map(([key, label]) =>
        option(String(key), String(label), ['низкий', 'средний', 'высокий'], 'Факторы 16PF-A')
      );
    case 'color-types': {
      const labels = scoring.labels || {};
      return [
        option('green', String(labels.green || 'Зелёный'), ['ведущий', 'вторичный', 'слабый'], 'Цветотипы'),
        option('red', String(labels.red || 'Красный'), ['ведущий', 'вторичный', 'слабый'], 'Цветотипы'),
        option('blue', String(labels.blue || 'Синий'), ['ведущий', 'вторичный', 'слабый'], 'Цветотипы'),
      ];
    }
    default: {
      if (scoring?.tag_to_name) {
        return Object.entries(scoring.tag_to_name).map(([key, label]) =>
          option(String(key), String(label), ['выражен', 'умеренный', 'ослаблен'], 'Показатели')
        );
      }
      if (scoring?.scale_to_name) {
        return Object.entries(scoring.scale_to_name).map(([key, label]) =>
          option(String(key), String(label), ['низкий', 'средний', 'высокий'], 'Шкалы')
        );
      }
      return [];
    }
  }
}

export async function getMethodBaseCatalog(): Promise<MethodCatalogTest[]> {
  const tests = await getAllTests();
  return tests
    .map((test) => ({
      slug: test.slug,
      title: test.title,
      resultOptions: buildResultOptions(test),
    }))
    .filter((test) => test.resultOptions.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}
