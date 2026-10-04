# Translations awaiting native-speaker review

Hausa (`ha`) and French (`fr`) strings are written best-effort during development and **must not ship enabled** until reviewed. `__tests__/i18n/catalogs.test.ts` fails if any key is missing here or its draft text differs from the catalogue, so every new or changed string is re-queued for review. Each new key is listed here by the task that added it. Remove rows once a paid native-speaker reviewer has approved them. Enabling `ha`/`fr` in the release config and adding the French store listing (T7.1) are blocked until the relevant section is empty.

## Reviewers
- Hausa: not yet assigned
- French: not yet assigned

## Notes for reviewers
- Hausa `errors.UNSUPPORTED.title` ("Ba a goyan bayan irin wannan fayil"): code review suggested the usual form is "goyon baya"; please confirm.
- Units: French uses o/Ko/Mo/Go; Hausa drafts keep B/KB/MB/GB. Please confirm what Hausa readers expect.

## Pending keys

| Key | en | ha (draft) | fr (draft) | Added in |
|-----|----|-----------|-----------|----------|
| `common.cancel` | Cancel | Soke | Annuler | T0.6 |
| `common.close` | Close | Rufe | Fermer | T0.6 |
| `errors.PASSWORD_REQUIRED.title` | This file is password-protected | Wannan fayil yana da kalmar sirri | Ce fichier est protégé par un mot de passe | T0.6 |
| `errors.PASSWORD_REQUIRED.message` | Enter the password to open it. | Shigar da kalmar sirri don buɗe shi. | Saisissez le mot de passe pour l’ouvrir. | T0.6 |
| `errors.WRONG_PASSWORD.title` | Wrong password | Kalmar sirri ba daidai ba ce | Mot de passe incorrect | T0.6 |
| `errors.WRONG_PASSWORD.message` | That password did not work. Check it and try again. | Wannan kalmar sirri ba ta yi aiki ba. Duba ta sannan ka sake gwadawa. | Ce mot de passe ne fonctionne pas. Vérifiez-le et réessayez. | T0.6 |
| `errors.CORRUPT_FILE.title` | This file is damaged | Wannan fayil ya lalace | Ce fichier est endommagé | T0.6 |
| `errors.CORRUPT_FILE.message` | It may not have downloaded completely. Try getting the file again. | Wataƙila ba a sauke shi gaba ɗaya ba. Ka sake samun fayil ɗin. | Il n’a peut-être pas été téléchargé entièrement. Essayez de récupérer le fichier à nouveau. | T0.6 |
| `errors.UNSUPPORTED.title` | This file type isn't supported | Ba a goyan bayan irin wannan fayil | Ce type de fichier n’est pas pris en charge | T0.6 |
| `errors.UNSUPPORTED.message` | Try opening a PDF, image or Office document instead. | Gwada buɗe PDF, hoto ko takardar Office maimakon haka. | Essayez plutôt d’ouvrir un PDF, une image ou un document Office. | T0.6 |
| `errors.NO_SPACE.title` | Your phone is out of storage | Ma’ajiyar wayarka ta cika | Le stockage de votre téléphone est plein | T0.6 |
| `errors.NO_SPACE.message` | Free up some space, then try again. | Ka samar da sarari, sannan ka sake gwadawa. | Libérez de l’espace, puis réessayez. | T0.6 |
| `errors.OUT_OF_MEMORY.title` | This file is too large to handle right now | Wannan fayil ya yi girma sosai a yanzu | Ce fichier est trop volumineux pour le moment | T0.6 |
| `errors.OUT_OF_MEMORY.message` | Close other apps and try again. | Ka rufe wasu manhajoji sannan ka sake gwadawa. | Fermez d’autres applications et réessayez. | T0.6 |
| `errors.CANCELLED.title` | Cancelled | An soke | Annulé | T0.6 |
| `errors.CANCELLED.message` | Nothing was changed. | Ba a canza komai ba. | Rien n’a été modifié. | T0.6 |
| `errors.PERMISSION_DENIED.title` | Permission needed | Ana buƙatar izini | Autorisation nécessaire | T0.6 |
| `errors.PERMISSION_DENIED.message` | Allow access in Settings so the app can open your documents. | Ka ba da izini a cikin Saituna domin manhajar ta iya buɗe takardunka. | Autorisez l’accès dans les Paramètres pour que l’application puisse ouvrir vos documents. | T0.6 |
| `errors.NOT_FOUND.title` | File not found | Ba a sami fayil ɗin ba | Fichier introuvable | T0.6 |
| `errors.NOT_FOUND.message` | It may have been moved or deleted. | Wataƙila an motsa shi ko an goge shi. | Il a peut-être été déplacé ou supprimé. | T0.6 |
| `errors.UNKNOWN.title` | Something went wrong | Wani abu ya faru ba daidai ba | Une erreur est survenue | T0.6 |
| `errors.UNKNOWN.message` | Please try again. | Don Allah ka sake gwadawa. | Veuillez réessayer. | T0.6 |
| `recovery.retry` | Try again | Sake gwadawa | Réessayer | T0.6 |
| `recovery.enterPassword` | Enter password | Shigar da kalmar sirri | Saisir le mot de passe | T0.6 |
| `recovery.freeSpace` | Free up space | Samar da sarari | Libérer de l’espace | T0.6 |
| `recovery.openSettings` | Open Settings | Buɗe Saituna | Ouvrir les Paramètres | T0.6 |
| `recovery.pickAnotherFile` | Choose another file | Zaɓi wani fayil | Choisir un autre fichier | T0.6 |
| `units.byte` | B | B | o | T0.6 |
| `units.kilobyte` | KB | KB | Ko | T0.6 |
| `units.megabyte` | MB | MB | Mo | T0.6 |
| `units.gigabyte` | GB | GB | Go | T0.6 |
| `language.title` | Language | Harshe | Langue | T0.6 |
| `language.system` | Use phone language | Yi amfani da harshen waya | Utiliser la langue du téléphone | T0.6 |
| `onboarding.title` | Your documents, ready when you are | Takardunka, a shirye duk lokacin da kake so | Vos documents, prêts quand vous l’êtes | T1.2 |
| `onboarding.valueTools` | Read, scan and compress PDFs in one app | Karanta, yi sikan kuma rage girman PDF a manhaja ɗaya | Lisez, numérisez et compressez vos PDF dans une seule application | T1.2 |
| `onboarding.valuePrivate` | Works offline. Your files stay on your phone | Yana aiki ba tare da intanet ba. Fayilolinka suna nan a wayarka | Fonctionne hors ligne. Vos fichiers restent sur votre téléphone | T1.2 |
| `onboarding.valueNoAds` | No ads while you read | Babu talla yayin da kake karantawa | Aucune publicité pendant la lecture | T1.2 |
| `onboarding.allowAccess` | Allow access to find all documents | Ba da izini don nemo duk takardu | Autoriser l’accès pour trouver tous les documents | T1.2 |
| `onboarding.allowAccessHint` | Opens Settings. You can change this at any time. | Yana buɗe Saituna. Za ka iya canza wannan a kowane lokaci. | Ouvre les Paramètres. Vous pouvez modifier ce choix à tout moment. | T1.2 |
| `onboarding.pickFiles` | Pick files manually | Zaɓi fayiloli da kanka | Choisir des fichiers manuellement | T1.2 |
| `onboarding.manualNote` | Everything works without access. You can pick files yourself. | Komai yana aiki ba tare da izini ba. Za ka iya zaɓar fayiloli da kanka. | Tout fonctionne sans cet accès. Vous pouvez choisir vos fichiers vous-même. | T1.2 |
| `access.bannerMessage` | Allow access so the app can find all your documents automatically. | Ba da izini domin manhajar ta nemo duk takardunka kai tsaye. | Autorisez l’accès pour que l’application trouve automatiquement tous vos documents. | T1.2 |
| `access.allow` | Allow access | Ba da izini | Autoriser l’accès | T1.2 |
| `library.untitled` | Untitled document | Takarda marar suna | Document sans titre | T1.2 |
| `common.errorToast` | {{title}}. {{message}} | {{title}}. {{message}} | {{title}}. {{message}} | T1.2 |
| `library.evictedOldPicks` | To make room, older picked files were removed from your library ({{count}}). Pick them again to get them back. | Don samar da wuri, an cire tsofaffin fayilolin da ka zaɓa daga ɗakin karatu ({{count}}). Ka sake zaɓar su don dawo da su. | Pour faire de la place, d’anciens fichiers choisis ont été retirés de la bibliothèque ({{count}}). Choisissez-les à nouveau pour les récupérer. | T1.2 |
| `library.cannotKeepAccess` | Some files couldn’t be added: their source app doesn’t allow lasting access. Try saving them to your phone first. | Ba a iya ƙara wasu fayiloli ba: manhajar da suka fito ba ta ba da izini na dindindin. Ka gwada ajiye su a wayarka da farko. | Certains fichiers n’ont pas pu être ajoutés : leur application d’origine n’autorise pas un accès durable. Essayez d’abord de les enregistrer sur votre téléphone. | T1.2 |
