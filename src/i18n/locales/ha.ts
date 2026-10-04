// Draft Hausa. Hidden until reviewed: see docs/TRANSLATIONS_TO_REVIEW.md.
import type { Catalog } from './en';

export const ha: Catalog = {
  common: {
    cancel: 'Soke',
    close: 'Rufe',
    errorToast: '{{title}}. {{message}}',
  },
  errors: {
    PASSWORD_REQUIRED: {
      title: 'Wannan fayil yana da kalmar sirri',
      message: 'Shigar da kalmar sirri don buɗe shi.',
    },
    WRONG_PASSWORD: {
      title: 'Kalmar sirri ba daidai ba ce',
      message: 'Wannan kalmar sirri ba ta yi aiki ba. Duba ta sannan ka sake gwadawa.',
    },
    CORRUPT_FILE: {
      title: 'Wannan fayil ya lalace',
      message: 'Wataƙila ba a sauke shi gaba ɗaya ba. Ka sake samun fayil ɗin.',
    },
    UNSUPPORTED: {
      title: 'Ba a goyan bayan irin wannan fayil',
      message: 'Gwada buɗe PDF, hoto ko takardar Office maimakon haka.',
    },
    NO_SPACE: {
      title: 'Ma’ajiyar wayarka ta cika',
      message: 'Ka samar da sarari, sannan ka sake gwadawa.',
    },
    OUT_OF_MEMORY: {
      title: 'Wannan fayil ya yi girma sosai a yanzu',
      message: 'Ka rufe wasu manhajoji sannan ka sake gwadawa.',
    },
    CANCELLED: {
      title: 'An soke',
      message: 'Ba a canza komai ba.',
    },
    PERMISSION_DENIED: {
      title: 'Ana buƙatar izini',
      message: 'Ka ba da izini a cikin Saituna domin manhajar ta iya buɗe takardunka.',
    },
    NOT_FOUND: {
      title: 'Ba a sami fayil ɗin ba',
      message: 'Wataƙila an motsa shi ko an goge shi.',
    },
    UNKNOWN: {
      title: 'Wani abu ya faru ba daidai ba',
      message: 'Don Allah ka sake gwadawa.',
    },
  },
  recovery: {
    retry: 'Sake gwadawa',
    enterPassword: 'Shigar da kalmar sirri',
    freeSpace: 'Samar da sarari',
    openSettings: 'Buɗe Saituna',
    pickAnotherFile: 'Zaɓi wani fayil',
  },
  units: {
    byte: 'B',
    kilobyte: 'KB',
    megabyte: 'MB',
    gigabyte: 'GB',
  },
  language: {
    title: 'Harshe',
    system: 'Yi amfani da harshen waya',
  },
  onboarding: {
    title: 'Takardunka, a shirye duk lokacin da kake so',
    valueTools: 'Karanta, yi sikan kuma rage girman PDF a manhaja ɗaya',
    valuePrivate: 'Yana aiki ba tare da intanet ba. Fayilolinka suna nan a wayarka',
    valueNoAds: 'Babu talla yayin da kake karantawa',
    allowAccess: 'Ba da izini don nemo duk takardu',
    allowAccessHint: 'Yana buɗe Saituna. Za ka iya canza wannan a kowane lokaci.',
    pickFiles: 'Zaɓi fayiloli da kanka',
    manualNote: 'Komai yana aiki ba tare da izini ba. Za ka iya zaɓar fayiloli da kanka.',
  },
  access: {
    bannerMessage: 'Ba da izini domin manhajar ta nemo duk takardunka kai tsaye.',
    allow: 'Ba da izini',
  },
  library: {
    untitled: 'Takarda marar suna',
    evictedOldPicks:
      'Don samar da wuri, an cire tsofaffin fayilolin da ka zaɓa daga ɗakin karatu ({{count}}). Ka sake zaɓar su don dawo da su.',
    cannotKeepAccess:
      'Ba a iya ƙara wasu fayiloli ba: manhajar da suka fito ba ta ba da izini na dindindin. Ka gwada ajiye su a wayarka da farko.',
  },
};
