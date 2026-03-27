import { getAllTests } from '@/lib/loadTests';
import type { AnyTest } from '@/lib/testTypes';

export type MethodResultOption = {
  key: string;
  label: string;
  group?: string;
  suggestedValues: string[];
  description?: string;
  valueMode: 'qualitative' | 'numeric';
  minValue?: number;
  maxValue?: number;
  step?: number;
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

function option(key: string, label: string, suggestedValues: string[], group?: string, description?: string): MethodResultOption {
  return {
    key,
    label,
    group,
    suggestedValues: uniq(suggestedValues),
    description: description?.trim() || undefined,
    valueMode: 'qualitative',
  };
}

function numericOption(key: string, label: string, minValue: number, maxValue: number, group?: string, description?: string, step = 1): MethodResultOption {
  return {
    key,
    label,
    group,
    suggestedValues: [],
    description: description?.trim() || undefined,
    valueMode: 'numeric',
    minValue,
    maxValue,
    step,
  };
}

const PF16_DESCRIPTIONS: Record<string, string> = {
  A: 'Показывает теплоту, открытость и лёгкость эмоционального контакта. Высокие значения чаще связаны с дружелюбием и включённостью в людей, низкие — с большей сдержанностью и дистанцией.',
  B: 'Отражает интеллектуальную гибкость, скорость схватывания и способность оперировать абстракциями. Это не школьная отметка, а общий стиль мыслительной обработки.',
  C: 'Показывает эмоциональную устойчивость и способность держать внутреннее равновесие под нагрузкой. Высокие значения обычно говорят о большей собранности, низкие — о чувствительности к стрессу.',
  E: 'Описывает доминирование и напористость в контакте. Высокие значения связаны с готовностью влиять и продавливать позицию, низкие — с большей уступчивостью и мягкостью.',
  F: 'Отражает живость, энергичность и внешнюю спонтанность. Высокие значения чаще дают оживлённость и экспрессивность, низкие — более серьёзный и сдержанный стиль.',
  G: 'Показывает нормативность, опору на правила и внутреннюю дисциплину. Высокие значения связаны с ответственностью и соблюдением рамок, низкие — с большей свободой от регламентов.',
  H: 'Описывает социальную смелость и готовность действовать в новых или напряжённых ситуациях. Высокие значения — про риск, контакт и выход вперёд, низкие — про осторожность и скованность.',
  I: 'Показывает чувствительность, деликатность и тонкость эмоционального отклика. Высокие значения связаны с мягкостью и восприимчивостью, низкие — с большей жёсткостью и прагматичностью.',
  L: 'Отражает подозрительность и настороженность в отношении мотивов других людей. Высокие значения чаще дают критичность и недоверие, низкие — более лёгкое доверие и прямоту.',
  M: 'Описывает мечтательность, воображение и уход в идеи. Высокие значения связаны с фантазией и внутренними образами, низкие — с приземлённостью и практической ориентацией.',
  N: 'Показывает закрытость, дипломатичность и склонность держать внутреннее при себе. Высокие значения — больше избирательности и маскировки, низкие — больше прямоты и открытости.',
  O: 'Отражает тревожность, самокритичность и склонность внутренне переживать. Высокие значения чаще связаны с сомнениями и напряжением, низкие — с большей уверенностью и спокойствием.',
  Q1: 'Показывает открытость изменениям и готовность отходить от привычного. Высокие значения связаны с интересом к новому и пересмотру правил, низкие — с опорой на традицию и проверенные схемы.',
  Q2: 'Описывает самостоятельность в принятии решений и потребность опираться на себя. Высокие значения дают автономность, низкие — большую важность группы, поддержки и согласования.',
  Q3: 'Показывает самоконтроль, организованность и способность держать форму поведения. Высокие значения связаны с дисциплиной и собранностью, низкие — с меньшей структурированностью и импульсивностью.',
  Q4: 'Отражает внутреннюю напряжённость и уровень накопленного психического давления. Высокие значения могут указывать на драйв и внутреннюю взвинченность, низкие — на расслабленность и меньший внутренний нажим.',
};

const BELBIN_FALLBACK_DESCRIPTIONS: Record<string, string> = {
  CW: 'Роль человека, который доводит дело до завершения, любит порядок, сроки и аккуратность. Сильна там, где нужны надёжность и внимание к деталям.',
  CH: 'Роль координатора, который умеет удерживать общую рамку, распределять участие и собирать людей вокруг задачи. Сильна в согласовании и организации совместной работы.',
  SH: 'Роль напористого организатора, который двигает группу вперёд, поднимает темп и не даёт застревать. Сильна там, где нужно давление на результат и преодоление инерции.',
  PL: 'Роль генератора идей, который приносит нестандартные решения и новые ходы. Сильна на этапе поиска концепций, гипотез и нестандартных подходов.',
  RI: 'Роль человека, который видит внешние ресурсы, возможности и контакты. Сильна там, где нужно находить новых людей, идеи, каналы и точки входа.',
  ME: 'Роль аналитика, который трезво взвешивает варианты и замечает слабые места решений. Сильна в оценке рисков, качества и реалистичности замыслов.',
  TW: 'Роль гармонизатора, который чувствует атмосферу группы и помогает удерживать рабочие отношения. Сильна в сглаживании напряжения и поддержке сотрудничества.',
  CF: 'Роль контролёра, который смотрит на ошибки, противоречия и то, что может пойти не так. Сильна там, где нужна критическая проверка и защита от недочётов.',
};

const EMIN_DESCRIPTIONS: Record<string, string> = {
  MP: 'Показывает, насколько человек замечает и понимает эмоциональные состояния других людей: оттенки чувств, сигналы напряжения, смену настроения и скрытые переживания.',
  MU: 'Отражает способность влиять на эмоции других людей: успокаивать, поддерживать, менять тон общения, снижать напряжение или направлять эмоциональный фон.',
  VP: 'Показывает, насколько человек понимает собственные эмоции, различает свои состояния и может назвать, что именно с ним происходит внутри.',
  VU: 'Отражает способность управлять своими эмоциями: не только чувствовать их, но и удерживать, регулировать, не срываться и возвращать себе рабочее состояние.',
  VE: 'Показывает контроль внешнего выражения эмоций — насколько человек управляет мимикой, тоном, импульсивной реакцией и тем, как эмоции считываются окружающими.',
  MEI: 'Сводный межличностный показатель. Показывает, насколько уверенно человек ориентируется в эмоциях других людей и умеет с ними работать в контакте.',
  VEI: 'Сводный внутриличностный показатель. Показывает уровень понимания и управления собственными эмоциональными состояниями.',
  PE: 'Общий показатель понимания эмоций — своих и чужих. Чем он выше, тем проще человеку распознавать эмоциональную картину происходящего.',
  UE: 'Общий показатель управления эмоциями — своими и чужими. Показывает, насколько человек умеет не только понимать чувства, но и что-то с ними делать.',
  OEI: 'Итоговый общий эмоциональный интеллект. Это интегральная картина того, как человек распознаёт эмоции и регулирует эмоциональные процессы.',
};

const LEARNING_DESCRIPTIONS: Record<string, string> = {
  OBS: 'Наблюдатель лучше учится через просмотр, сравнение, фиксацию деталей и спокойное осмысление со стороны. Ему важны время на наблюдение и качественные примеры.',
  EXP: 'Экспериментатор лучше осваивает материал через пробу, действие и проверку гипотез. Для него важны динамика, опыт и возможность быстро тестировать идеи.',
  PRA: 'Практик лучше учится через прикладную работу и понятную пользу. Ему важно быстро увидеть, как знание работает в реальной задаче.',
  THE: 'Теоретик лучше осваивает материал через схемы, модели, принципы и внутреннюю логику. Ему важно понять систему, а не только отдельный навык.',
};

const MOTIVATION_DESCRIPTIONS: Record<string, string> = {
  A: 'Показывает, насколько человека мотивирует материальное вознаграждение, понятная оплата и ощущение справедливого обмена усилий на деньги.',
  B: 'Отражает важность признания, одобрения, статуса и видимой оценки со стороны других людей. Это про потребность быть замеченным и оценённым.',
  C: 'Показывает значимость ответственности, полномочий и возможности влиять на решения. Это мотив автономии и управленческого веса.',
  D: 'Отражает чувствительность к качеству управления, справедливости администрации и тому, как устроена организационная среда.',
  E: 'Показывает, насколько человека мотивируют рост, развитие, обучение и движение вперёд. Это про внутреннюю тягу к расширению возможностей.',
  F: 'Отражает значимость достижений, результата и чувства “я справился”. Это мотив эффективности, победы и завершённого успеха.',
  H: 'Показывает интерес к самой работе как к содержательному процессу. Здесь важны смысл задачи, увлечённость делом и удовольствие от самой деятельности.',
  I: 'Отражает важность климата в коллективе, качества отношений и эмоциональной атмосферы вокруг работы.',
};

const SITUATIONAL_DESCRIPTIONS: Record<string, string> = {
  S1: 'Стиль прямого инструктажа: много указаний, ясная структура, контроль шагов и темпа. Обычно уместен там, где человеку не хватает опыта, ясности или устойчивости.',
  S2: 'Стиль убеждения: руководитель не только задаёт направление, но и объясняет, вовлекает и помогает принять задачу. Подходит, когда нужна и рамка, и поддержка принятия.',
  S3: 'Поддерживающий стиль: меньше жёстких указаний, больше участия, обсуждения и эмоциональной опоры. Полезен, когда человеку нужна включённость и укрепление уверенности.',
  S4: 'Делегирующий стиль: высокая автономия, передача ответственности и минимум оперативного контроля. Лучше работает с более зрелыми и самостоятельными сотрудниками.',
  flexibility: 'Суммарный количественный показатель гибкости: чем он выше, тем свободнее человек переключается между стилями руководства вместо застревания в одном привычном способе.',
  adequacy: 'Количественный показатель адекватности применения стилей: фактически это число попаданий по диагонали, когда выбранный стиль лучше соответствует ситуации и уровню готовности сотрудника.',
  polarity: 'Количественный показатель крайних отклонений: чем он выше, тем чаще человек уходит в резкие полярные решения вместо более точного попадания в ситуацию.',
};

const TIME_DESCRIPTIONS: Record<string, string> = {
  L: 'Линейное восприятие времени связано с последовательностью, планом, движением по шагам и комфортом в понятной структуре “сначала — потом”.',
  P: 'Параллельное восприятие времени связано с многозадачностью, одновременным удержанием нескольких линий и быстрым переключением контекстов.',
  C: 'Циклическое восприятие времени связано с чувствительностью к ритмам, фазам энергии, необходимости восстановления и повторяющимся рабочим циклам.',
};

const USK_DESCRIPTIONS: Record<string, string> = {
  IO: 'Общая интернальность показывает, в какой мере человек в целом ощущает себя источником происходящего в своей жизни, а не объектом внешних обстоятельств.',
  ID: 'Интернальность достижений показывает, склонен ли человек приписывать свои успехи собственным усилиям, решениям и качествам.',
  IN: 'Интернальность неудач показывает, берёт ли человек на себя часть ответственности за ошибки и сбои или в большей степени выносит причины вовне.',
  IS: 'Интернальность семейных отношений показывает, насколько человек ощущает собственное влияние на то, как складываются отношения в семье и близком круге.',
  IP: 'Интернальность производственных отношений показывает, ощущает ли человек свою субъектность и ответственность в профессиональной и рабочей сфере.',
  IM: 'Интернальность межличностных отношений отражает, считает ли человек, что качество общения и контактов во многом зависит от его собственных действий.',
  IZ: 'Интернальность здоровья и болезни показывает, видит ли человек связь между своим образом действий и состоянием здоровья, либо сильнее опирается на внешние факторы.',
};

const COLOR_DESCRIPTIONS: Record<string, string> = {
  green: 'Зелёный цветотип обычно связан с чувствительностью к людям, атмосферой отношений, эмпатией и вниманием к эмоциональному климату.',
  red: 'Красный цветотип обычно связан с волей, напором, скоростью, решительностью и ориентацией на результат и влияние.',
  blue: 'Синий цветотип обычно связан с аналитичностью, структурностью, логикой, качеством и потребностью в ясных опорах и системности.',
};

function genericNegotiationDescription(label: string) {
  return `Этот показатель отражает выраженность переговорного стиля «${label}» и помогает понять, как человек ведёт себя в переговорах: на что делает ставку, чем усиливает позицию и где могут появляться ограничения или риски перегиба.`;
}

function genericForcedPairDescription(label: string) {
  return `Этот показатель отражает выраженность стиля «${label}». Его удобно использовать в связках с другими тестами, чтобы увидеть, чем такой стиль усиливается, ослабляется или входит в противоречие с другими результатами.`;
}

function getDescription(test: AnyTest, key: string, label: string): string | undefined {
  const slug = String((test as any)?.slug || '');
  const scoring: any = (test as any)?.scoring || {};

  if (slug === '16pf-a') return PF16_DESCRIPTIONS[key];
  if (slug === 'belbin') return (scoring?.role_to_desc?.[key] as string | undefined) || BELBIN_FALLBACK_DESCRIPTIONS[key];
  if (slug === 'emin') return EMIN_DESCRIPTIONS[key];
  if (slug === 'learning-typology') return LEARNING_DESCRIPTIONS[key];
  if (slug === 'motivation-cards') return MOTIVATION_DESCRIPTIONS[key];
  if (slug === 'situational-guidance') return SITUATIONAL_DESCRIPTIONS[key];
  if (slug === 'time-management') return TIME_DESCRIPTIONS[key];
  if (slug === 'usk') return USK_DESCRIPTIONS[key];
  if (slug === 'color-types') return COLOR_DESCRIPTIONS[key];
  if (slug === 'negotiation-style') return genericNegotiationDescription(label);
  if (scoring?.tag_to_style) return genericForcedPairDescription(label);
  return undefined;
}

function getBelbinMaxByRole(test: AnyTest) {
  const scoring: any = (test as any)?.scoring || {};
  const totalPerSection = Number(scoring?.total_per_section ?? 10);
  const keys = Array.isArray(scoring?.keys) ? scoring.keys : [];
  const out: Record<string, number> = {};
  for (const key of keys) {
    const roleToLetter = key?.role_to_letter || {};
    for (const role of Object.keys(roleToLetter)) {
      out[role] = (out[role] ?? 0) + totalPerSection;
    }
  }
  return out;
}

function getMotivationMaxByFactor(test: AnyTest) {
  const scoring: any = (test as any)?.scoring || {};
  const factors = Array.isArray(scoring?.factors) ? scoring.factors : [];
  const out: Record<string, number> = Object.fromEntries(factors.map((factor: string) => [factor, 0]));
  for (const q of Array.isArray((test as any)?.questions) ? (test as any).questions : []) {
    const maxPoints = Number(q?.maxPoints ?? 5);
    const left = String(q?.left?.factor || '').trim();
    const right = String(q?.right?.factor || '').trim();
    if (left) out[left] = (out[left] ?? 0) + maxPoints;
    if (right) out[right] = (out[right] ?? 0) + maxPoints;
  }
  return out;
}

function getLearningMaxByTag(test: AnyTest) {
  const scoring: any = (test as any)?.scoring || {};
  const tags = Array.isArray(scoring?.tags) ? scoring.tags : [];
  const out: Record<string, number> = Object.fromEntries(tags.map((tag: string) => [tag, 0]));
  for (const q of Array.isArray((test as any)?.questions) ? (test as any).questions : []) {
    for (const tag of tags) {
      if ((q?.options || []).some((opt: any) => Array.isArray(opt?.tags) && opt.tags.includes(tag))) {
        out[tag] = (out[tag] ?? 0) + 1;
      }
    }
  }
  return out;
}

function getColorMinMaxByKey() {
  return {
    green: { min: 2, max: 24 },
    red: { min: 2, max: 24 },
    blue: { min: 2, max: 24 },
  };
}

function buildResultOptions(test: AnyTest): MethodResultOption[] {
  const scoring: any = (test as any)?.scoring || {};
  const questionCount = Array.isArray((test as any)?.questions) ? (test as any).questions.length : 0;

  switch (test.slug) {
    case 'situational-guidance': {
      const flexMax = (Array.isArray(scoring?.keys) ? scoring.keys : []).reduce((acc: number, key: any) => {
        const pts = key?.points || {};
        const maxPoint = Math.max(...Object.values(pts).map((v: any) => Number(v ?? 0)), 0);
        return acc + maxPoint;
      }, 0);
      const styles = Object.entries(scoring.style_to_name || {}).map(([key, label]) =>
        numericOption(String(key), String(label), 0, questionCount || 12, 'Стили', getDescription(test, String(key), String(label)))
      );
      return [
        ...styles,
        numericOption('flexibility', 'Гибкость стиля', 0, flexMax || 36, 'Итоговые показатели', getDescription(test, 'flexibility', 'Гибкость стиля')),
        numericOption('adequacy', 'Адекватность стиля (по диагонали)', 0, questionCount || 12, 'Итоговые показатели', getDescription(test, 'adequacy', 'Адекватность стиля')),
        numericOption('polarity', 'Полярность (крайние отклонения)', 0, questionCount || 12, 'Итоговые показатели', getDescription(test, 'polarity', 'Полярность распределения стилей')),
      ];
    }
    case 'emin': {
      return Object.entries(scoring.scale_to_name || {}).map(([key, label]) => {
        const norms = Array.isArray(scoring.norms?.[key]) ? scoring.norms[key] : [];
        const suggested = norms.map((x: any) => x?.label).filter(Boolean);
        return option(String(key), String(label), suggested.length ? suggested : ['низкий', 'средний', 'высокий'], 'Шкалы ЭМИН', getDescription(test, String(key), String(label)));
      });
    }
    case 'usk':
      return Object.entries(scoring.scale_to_name || {}).map(([key, label]) =>
        option(String(key), String(label), ['низкий', 'средний', 'высокий'], 'Шкалы УСК', getDescription(test, String(key), String(label)))
      );
    case 'belbin': {
      const maxByRole = getBelbinMaxByRole(test);
      return Object.entries(scoring.role_to_name || {}).map(([key, label]) =>
        numericOption(String(key), String(label), 0, Number(maxByRole[key] ?? 70), 'Командные роли', getDescription(test, String(key), String(label)))
      );
    }
    case 'time-management':
      return Object.entries(scoring.tag_to_name || {}).map(([key, label]) =>
        numericOption(String(key), String(label), 0, questionCount || 14, 'Типы восприятия времени', getDescription(test, String(key), String(label)))
      );
    case 'learning-typology': {
      const maxByTag = getLearningMaxByTag(test);
      return Object.entries(scoring.tag_to_name || {}).map(([key, label]) =>
        numericOption(String(key), String(label), 0, Number(maxByTag[key] ?? questionCount ?? 20), 'Стили обучения', getDescription(test, String(key), String(label)))
      );
    }
    case 'motivation-cards': {
      const maxByFactor = getMotivationMaxByFactor(test);
      return Object.entries(scoring.factor_to_name || {}).map(([key, label]) =>
        numericOption(String(key), String(label), 0, Number(maxByFactor[key] ?? 35), 'Мотиваторы', getDescription(test, String(key), String(label)))
      );
    }
    case '16pf-a':
      return Object.entries(scoring.factor_to_name || {}).map(([key, label]) =>
        option(String(key), String(label), ['низкий', 'средний', 'высокий'], 'Факторы 16PF-A', getDescription(test, String(key), String(label)))
      );
    case 'color-types': {
      const labels = scoring.labels || {};
      const minMax = getColorMinMaxByKey();
      return [
        numericOption('green', String(labels.green || 'Зелёный'), minMax.green.min, minMax.green.max, 'Цветотипы', getDescription(test, 'green', String(labels.green || 'Зелёный'))),
        numericOption('red', String(labels.red || 'Красный'), minMax.red.min, minMax.red.max, 'Цветотипы', getDescription(test, 'red', String(labels.red || 'Красный'))),
        numericOption('blue', String(labels.blue || 'Синий'), minMax.blue.min, minMax.blue.max, 'Цветотипы', getDescription(test, 'blue', String(labels.blue || 'Синий'))),
      ];
    }
    default: {
      if (scoring?.tag_to_style) {
        return Object.entries(scoring.tag_to_style).map(([key, label]) =>
          numericOption(String(key), String(label), 0, questionCount || 0, 'Стили', getDescription(test, String(key), String(label)))
        );
      }
      if (scoring?.tag_to_name) {
        return Object.entries(scoring.tag_to_name).map(([key, label]) =>
          numericOption(String(key), String(label), 0, questionCount || 0, 'Показатели', getDescription(test, String(key), String(label)))
        );
      }
      if (scoring?.scale_to_name) {
        return Object.entries(scoring.scale_to_name).map(([key, label]) =>
          option(String(key), String(label), ['низкий', 'средний', 'высокий'], 'Шкалы', getDescription(test, String(key), String(label)))
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
