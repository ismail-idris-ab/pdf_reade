# Translations awaiting native-speaker review

Hausa (`ha`) and French (`fr`) strings are written best-effort during development and **must not ship enabled** until reviewed. `__tests__/i18n/catalogs.test.ts` fails if any key is missing here or its draft text differs from the catalogue, so every new or changed string is re-queued for review. Each new key is listed here by the task that added it. Remove rows once a paid native-speaker reviewer has approved them. Enabling `ha`/`fr` in the release config and adding the French store listing (T7.1) are blocked until the relevant section is empty.

## Reviewers
- Hausa: not yet assigned
- French: not yet assigned

## Notes for reviewers
- Hausa `errors.UNSUPPORTED.title` ("Ba a goyan bayan irin wannan fayil"): code review suggested the usual form is "goyon baya"; please confirm.
- Units: French uses o/Ko/Mo/Go; Hausa drafts keep B/KB/MB/GB. Please confirm what Hausa readers expect.
- T1.4 `folders.deleteTitleWithItems_*` and `folders.importFailed_*` (`_one` / `_many` / `_other`) are i18next plural forms chosen by `count` (items in the folder; files that failed to import). CLDR: English and Hausa use one/other; French also uses "many" for very large round counts. Every catalogue has all three so the keys match; please check each form, the Hausa singulars in particular.
- T1.4 `folders.imported` still avoids plural forms ("({{count}})"); please suggest wording that reads naturally for a count of 1.
- T1.4 `names.invalidChars` lists the forbidden characters literally (\ / : * ? " < > |); keep them unchanged.

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
| `library.searchPlaceholder` | Search by name | Nemo da suna | Rechercher par nom | T1.3 |
| `library.clearSearch` | Clear search | Share bincike | Effacer la recherche | T1.3 |
| `library.showGrid` | Show as grid | Nuna cikin akwatuna | Afficher en grille | T1.3 |
| `library.showList` | Show as list | Nuna a jere | Afficher en liste | T1.3 |
| `library.sort` | Sort | Tsara | Trier | T1.3 |
| `library.sortBy` | Sort by | Tsara ta | Trier par | T1.3 |
| `library.order` | Order | Jeri | Ordre | T1.3 |
| `library.devTools` | Developer tools | Kayan masu haɓakawa | Outils de développement | T1.3 |
| `library.tabsLabel` | File types | Nau’ukan fayil | Types de fichiers | T1.3 |
| `library.chipsLabel` | Sources | Majiya | Sources | T1.3 |
| `library.tabs.all` | All | Duka | Tous | T1.3 |
| `library.tabs.pdf` | PDF | PDF | PDF | T1.3 |
| `library.tabs.word` | Word | Word | Word | T1.3 |
| `library.tabs.excel` | Excel | Excel | Excel | T1.3 |
| `library.tabs.other` | Other | Sauran | Autres | T1.3 |
| `library.chips.all` | All | Duka | Tous | T1.3 |
| `library.chips.downloads` | Downloads | Abubuwan da aka sauke | Téléchargements | T1.3 |
| `library.chips.whatsapp` | WhatsApp | WhatsApp | WhatsApp | T1.3 |
| `library.chips.scans` | Scans | Sikan | Numérisations | T1.3 |
| `library.chips.myfiles` | My Files | Fayilolina | Mes fichiers | T1.3 |
| `library.sortField.name` | Name | Suna | Nom | T1.3 |
| `library.sortField.date` | Date modified | Ranar gyara | Date de modification | T1.3 |
| `library.sortField.size` | Size | Girma | Taille | T1.3 |
| `library.sortDir.name.asc` | A to Z | A zuwa Z | De A à Z | T1.3 |
| `library.sortDir.name.desc` | Z to A | Z zuwa A | De Z à A | T1.3 |
| `library.sortDir.date.asc` | Oldest first | Mafi tsufa da farko | Plus anciens d’abord | T1.3 |
| `library.sortDir.date.desc` | Newest first | Mafi sabo da farko | Plus récents d’abord | T1.3 |
| `library.sortDir.size.asc` | Smallest first | Mafi ƙanƙanta da farko | Plus petits d’abord | T1.3 |
| `library.sortDir.size.desc` | Largest first | Mafi girma da farko | Plus grands d’abord | T1.3 |
| `library.recent` | Recent | Na baya-bayan nan | Récents | T1.3 |
| `library.favorites` | Favorites | Waɗanda aka fi so | Favoris | T1.3 |
| `library.fileDetails` | {{size}} · {{date}} | {{size}} · {{date}} | {{size}} · {{date}} | T1.3 |
| `library.locked` | Password-protected | Yana da kalmar sirri | Protégé par mot de passe | T1.3 |
| `library.empty.noFilesTitle` | No documents yet | Babu takardu tukuna | Aucun document pour l’instant | T1.3 |
| `library.empty.noFilesMessage` | Pick files from your phone to add them here. | Zaɓi fayiloli daga wayarka don ƙara su nan. | Choisissez des fichiers sur votre téléphone pour les ajouter ici. | T1.3 |
| `library.empty.pickFiles` | Pick files | Zaɓi fayiloli | Choisir des fichiers | T1.3 |
| `library.empty.noFilesHereTitle` | No files here yet | Babu fayiloli a nan tukuna | Aucun fichier ici pour l’instant | T1.3 |
| `library.empty.noFilesHereMessage` | Try another file type or source. | Gwada wani nau’in fayil ko wata majiya. | Essayez un autre type de fichier ou une autre source. | T1.3 |
| `library.empty.noMatchesTitle` | No matching files | Babu fayil da ya dace | Aucun fichier correspondant | T1.3 |
| `library.empty.noMatchesMessage` | Try a different name, or check the file type and source. | Gwada wani suna, ko duba nau’in fayil da majiya. | Essayez un autre nom, ou vérifiez le type de fichier et la source. | T1.3 |
| `fileActions.moreFor` | More actions for {{name}} | Ƙarin ayyuka don {{name}} | Plus d’actions pour {{name}} | T1.4 |
| `fileActions.longPressHint` | Long-press for more actions | Danna ka riƙe don ƙarin ayyuka | Appui long pour plus d’actions | T1.4 |
| `fileActions.favorite` | Add to favorites | Ƙara cikin waɗanda aka fi so | Ajouter aux favoris | T1.4 |
| `fileActions.unfavorite` | Remove from favorites | Cire daga waɗanda aka fi so | Retirer des favoris | T1.4 |
| `fileActions.rename` | Rename | Sake suna | Renommer | T1.4 |
| `fileActions.move` | Move | Matsar | Déplacer | T1.4 |
| `fileActions.copyToMyFiles` | Copy to My Files | Kwafa zuwa Fayilolina | Copier dans Mes fichiers | T1.4 |
| `fileActions.duplicate` | Duplicate | Yi kwafi | Dupliquer | T1.4 |
| `fileActions.details` | Details | Bayani | Détails | T1.4 |
| `fileActions.share` | Share | Raba | Partager | T1.4 |
| `fileActions.print` | Print | Buga | Imprimer | T1.4 |
| `fileActions.delete` | Delete | Goge | Supprimer | T1.4 |
| `fileActions.save` | Save | Ajiye | Enregistrer | T1.4 |
| `fileActions.nameLabel` | Name | Suna | Nom | T1.4 |
| `fileActions.savedAs` | Will be saved as “{{name}}” | Za a ajiye shi a matsayin “{{name}}” | Sera enregistré sous « {{name}} » | T1.4 |
| `fileActions.renameUnsupported` | This app can’t rename this file. Copy it to My Files to rename it. | Wannan manhaja ba za ta iya sake sunan wannan fayil ba. Ka kwafa shi zuwa Fayilolina don sake masa suna. | Cette application ne peut pas renommer ce fichier. Copiez-le dans Mes fichiers pour le renommer. | T1.4 |
| `fileActions.duplicateLeft` | The file was moved, but the original couldn’t be removed: a second copy is still in its old folder. | An matsar da fayil ɗin, amma ba a iya cire na asali ba: akwai kwafi na biyu a tsohon babban fayil ɗinsa. | Le fichier a été déplacé, mais l’original n’a pas pu être supprimé : une seconde copie reste dans son ancien dossier. | T1.4 |
| `fileActions.deleteTitle` | Delete “{{name}}”? | A goge “{{name}}”? | Supprimer « {{name}} » ? | T1.4 |
| `fileActions.deleteMessage` | This can’t be undone. | Ba za a iya dawo da wannan ba. | Cette action est irréversible. | T1.4 |
| `fileActions.favorited` | Added to favorites | An ƙara cikin waɗanda aka fi so | Ajouté aux favoris | T1.4 |
| `fileActions.unfavorited` | Removed from favorites | An cire daga waɗanda aka fi so | Retiré des favoris | T1.4 |
| `fileActions.renamed` | Renamed | An sake suna | Renommé | T1.4 |
| `fileActions.moved` | Moved to {{folder}} | An matsar zuwa {{folder}} | Déplacé dans {{folder}} | T1.4 |
| `fileActions.copied` | Copied to {{folder}} | An kwafa zuwa {{folder}} | Copié dans {{folder}} | T1.4 |
| `fileActions.duplicated` | Copy created | An yi kwafi | Copie créée | T1.4 |
| `fileActions.deleted` | Deleted | An goge | Supprimé | T1.4 |
| `fileActions.removeFromLibrary` | Remove from library | Cire daga ɗakin karatu | Retirer de la bibliothèque | T1.4 |
| `fileActions.removedFromLibrary` | Removed from library | An cire daga ɗakin karatu | Retiré de la bibliothèque | T1.4 |
| `fileActions.allowAccessToChange` | Allow all-files access so the app can change files on your phone. | Ba da izinin shiga duk fayiloli domin manhajar ta iya canza fayiloli a wayarka. | Autorisez l’accès à tous les fichiers pour que l’application puisse modifier les fichiers de votre téléphone. | T1.4 |
| `fileActions.moveTitle` | Move to | Matsar zuwa | Déplacer vers | T1.4 |
| `fileActions.copyTitle` | Copy to My Files | Kwafa zuwa Fayilolina | Copier dans Mes fichiers | T1.4 |
| `fileActions.moveHere` | Move here | Matsar nan | Déplacer ici | T1.4 |
| `fileActions.copyHere` | Copy here | Kwafa nan | Copier ici | T1.4 |
| `names.empty` | Enter a name. | Shigar da suna. | Saisissez un nom. | T1.4 |
| `names.invalidChars` | Names can’t contain any of these: \ / : * ? " < > \| | Suna ba zai iya ƙunsar ɗaya daga cikin waɗannan ba: \ / : * ? " < > \| | Un nom ne peut contenir aucun de ces caractères : \ / : * ? " < > \| | T1.4 |
| `names.invalid` | This name can’t be used. Choose another. | Ba za a iya amfani da wannan suna ba. Zaɓi wani. | Ce nom ne peut pas être utilisé. Choisissez-en un autre. | T1.4 |
| `names.leadingDot` | Names can’t start with a dot. | Suna ba zai iya farawa da digo ba. | Un nom ne peut pas commencer par un point. | T1.4 |
| `names.tooLong` | This name is too long. | Wannan suna ya yi tsawo sosai. | Ce nom est trop long. | T1.4 |
| `names.exists` | Something with this name is already here. | Akwai wani abu mai wannan suna a nan. | Un élément porte déjà ce nom ici. | T1.4 |
| `folders.root` | My Files | Fayilolina | Mes fichiers | T1.4 |
| `folders.pathLabel` | Folder path | Hanyar babban fayil | Chemin du dossier | T1.4 |
| `folders.folderLabel` | {{name}}, folder | {{name}}, babban fayil | {{name}}, dossier | T1.4 |
| `folders.newFolder` | New folder | Sabon babban fayil | Nouveau dossier | T1.4 |
| `folders.create` | Create | Ƙirƙira | Créer | T1.4 |
| `folders.import` | Import | Shigo da | Importer | T1.4 |
| `folders.up` | Up one level | Koma mataki ɗaya baya | Remonter d’un niveau | T1.4 |
| `folders.uninstallNote` | Files in My Files are removed if you uninstall the app. | Za a cire fayilolin da ke cikin Fayilolina idan ka cire manhajar. | Les fichiers de Mes fichiers sont supprimés si vous désinstallez l’application. | T1.4 |
| `folders.emptyTitle` | This folder is empty | Wannan babban fayil babu komai | Ce dossier est vide | T1.4 |
| `folders.emptyMessage` | Import files or create a folder. | Shigo da fayiloli ko ƙirƙiri babban fayil. | Importez des fichiers ou créez un dossier. | T1.4 |
| `folders.loadErrorTitle` | This folder couldn’t be opened | Ba a iya buɗe wannan babban fayil ba | Impossible d’ouvrir ce dossier | T1.4 |
| `folders.deleteTitle` | Delete “{{name}}”? | A goge “{{name}}”? | Supprimer « {{name}} » ? | T1.4 |
| `folders.deleteTitleWithItems_one` | Delete “{{name}}” and the item inside? | A goge “{{name}}” da abin da ke ciki? | Supprimer « {{name}} » et l’élément qu’il contient ? | T1.4 |
| `folders.deleteTitleWithItems_many` | Delete “{{name}}” and the {{count}} items inside? | A goge “{{name}}” da abubuwa {{count}} da ke ciki? | Supprimer « {{name}} » et les {{count}} d’éléments qu’il contient ? | T1.4 |
| `folders.deleteTitleWithItems_other` | Delete “{{name}}” and the {{count}} items inside? | A goge “{{name}}” da abubuwa {{count}} da ke ciki? | Supprimer « {{name}} » et les {{count}} éléments qu’il contient ? | T1.4 |
| `folders.created` | Folder created | An ƙirƙiri babban fayil | Dossier créé | T1.4 |
| `folders.renamed` | Folder renamed | An sake sunan babban fayil | Dossier renommé | T1.4 |
| `folders.deleted` | Folder deleted | An goge babban fayil | Dossier supprimé | T1.4 |
| `folders.imported` | Imported to My Files ({{count}}) | An shigo da su cikin Fayilolina ({{count}}) | Importé dans Mes fichiers ({{count}}) | T1.4 |
| `folders.importFailed_one` | {{count}} file of {{total}} couldn’t be imported. | Ba a iya shigo da fayil {{count}} daga cikin {{total}} ba. | {{count}} fichier sur {{total}} n’a pas pu être importé. | T1.4 |
| `folders.importFailed_many` | {{count}} of {{total}} files couldn’t be imported. | Ba a iya shigo da fayiloli {{count}} daga cikin {{total}} ba. | {{count}} de fichiers sur {{total}} n’ont pas pu être importés. | T1.4 |
| `folders.importFailed_other` | {{count}} of {{total}} files couldn’t be imported. | Ba a iya shigo da fayiloli {{count}} daga cikin {{total}} ba. | {{count}} fichiers sur {{total}} n’ont pas pu être importés. | T1.4 |
| `details.title` | Details | Bayani | Détails | T1.4 |
| `details.type` | Type | Nau’i | Type | T1.4 |
| `details.size` | Size | Girma | Taille | T1.4 |
| `details.modified` | Modified | An gyara | Modifié | T1.4 |
| `details.location` | Location | Wuri | Emplacement | T1.4 |
| `details.pages` | Pages | Shafuka | Pages | T1.4 |
| `details.typeValue` | {{ext}} file | Fayil ɗin {{ext}} | Fichier {{ext}} | T1.4 |
| `details.unknownType` | Unknown | Ba a sani ba | Inconnu | T1.4 |
| `details.pickedFile` | Picked file | Fayil da aka zaɓa | Fichier choisi | T1.4 |
| `details.phoneStorage` | Phone storage | Ma’ajiyar waya | Stockage du téléphone | T1.4 |
| `details.sdCard` | SD card | Katin SD | Carte SD | T1.4 |
