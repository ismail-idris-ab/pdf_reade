// Draft Hausa. Hidden until reviewed: see docs/TRANSLATIONS_TO_REVIEW.md.
import type { Catalog } from './en';

export const ha: Catalog = {
  common: {
    cancel: 'Soke',
    close: 'Rufe',
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
};
