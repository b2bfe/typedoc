/* eslint-disable @typescript-eslint/no-var-requires */
import * as Path from "path";
import lunr from "lunr";
// import "lunr-languages/lunr.multi.js";
// import "lunr-languages/lunr.stemmer.support.js";
// require("lunr-languages/lunr.multi.js")(lunr);
// require("lunr-languages/lunr.stemmer.support.js")(lunr);
require("lunr-languages/lunr.stemmer.support.js")(lunr);
require("lunr-languages/lunr.multi.js")(lunr);
require("lunr-languages/lunr.zh.js")(lunr);
import {
    Comment,
    DeclarationReflection,
    ProjectReflection,
} from "../../models";
import { Component, RendererComponent } from "../components";
import { IndexEvent, RendererEvent } from "../events";
import { BindOption, writeFileSync } from "../../utils";
import { DefaultTheme } from "../themes/default/DefaultTheme";
import type { LunrSupportLanugage } from "../../utils/options/declaration";

/**
 * Keep this in sync with the interface in src/lib/output/themes/default/assets/typedoc/components/Search.ts
 */
interface SearchDocument {
    kind: number;
    name: string;
    url: string;
    classes?: string;
    parent?: string;
}

/**
 * A plugin that exports an index of the project to a javascript file.
 *
 * The resulting javascript file can be used to build a simple search function.
 */
@Component({ name: "javascript-index" })
export class JavascriptIndexPlugin extends RendererComponent {
    @BindOption("searchInComments")
    searchComments!: boolean;

    @BindOption("searchInCommentsSupportLanguage")
    searchInCommentsSupportLanguage!: LunrSupportLanugage[];

    /**
     * Create a new JavascriptIndexPlugin instance.
     */
    override initialize() {
        this.listenTo(this.owner, RendererEvent.BEGIN, this.onRendererBegin);
    }

    /**
     * Triggered after a document has been rendered, just before it is written to disc.
     *
     * @param event  An event object describing the current render operation.
     */
    private async onRendererBegin(event: RendererEvent) {
        if (!(this.owner.theme instanceof DefaultTheme)) {
            return;
        }
        if (event.isDefaultPrevented) {
            return;
        }

        const rows: SearchDocument[] = [];

        const initialSearchResults = Object.values(
            event.project.reflections
        ).filter((refl) => {
            return (
                refl instanceof DeclarationReflection &&
                refl.url &&
                refl.name &&
                !refl.flags.isExternal
            );
        }) as DeclarationReflection[];

        const indexEvent = new IndexEvent(
            IndexEvent.PREPARE_INDEX,
            initialSearchResults
        );

        this.owner.trigger(indexEvent);

        if (indexEvent.isDefaultPrevented) {
            return;
        }

        const builder = new lunr.Builder();
        // builder.pipeline.add(trimmer);
        // if (this.searchInCommentsSupportLanguage.length > 0) {
        //     const languageList: Record<string, any> = {};
        //     // require("lunr-languages/lunr.multi.js")(lunr);
        //     // require("lunr-languages/lunr.stemmer.support.js")(lunr);
        //     for (const lang of this.searchInCommentsSupportLanguage) {
        //         const language = await import(`lunr-languages/lunr.${lang}.js`);
        //         languageList[lang] = language.default;
        //         console.log("language", languageList[lang]);
        //         console.log("typeof", languageList[lang](lunr));
        //         // builder.pipeline.add(languageList[lang](lunr).stemmer);
        //     }

        //     // this.searchInCommentsSupportLanguage.forEach((lang) => {
        //     //     // eslint-disable-next-line @typescript-eslint/no-var-requires
        //     //     const language = require(`lunr-languages/${lang}.js`)(lunr);
        //     //     builder.pipeline.add(language.stemmer);
        //     // });
        //     // } else {
        // }
        builder.pipeline.add((lunr as any).zh.trimmer!);

        builder.ref("id");
        for (const [key, boost] of Object.entries(
            indexEvent.searchFieldWeights
        )) {
            builder.field(key, { boost });
        }

        for (const reflection of indexEvent.searchResults) {
            if (!reflection.url) {
                continue;
            }

            const boost = reflection.relevanceBoost ?? 1;
            if (boost <= 0) {
                continue;
            }

            let parent = reflection.parent;
            if (parent instanceof ProjectReflection) {
                parent = undefined;
            }

            const row: SearchDocument = {
                kind: reflection.kind,
                name: reflection.name,
                url: reflection.url,
                classes: this.owner.theme.getReflectionClasses(reflection),
            };

            if (parent) {
                row.parent = parent.getFullName();
            }

            builder.add(
                {
                    name: reflection.name,
                    comment: this.getCommentSearchText(reflection),
                    ...indexEvent.searchFields[rows.length],
                    id: rows.length,
                },
                { boost }
            );
            rows.push(row);
        }

        const index = builder.build();

        const jsonFileName = Path.join(
            event.outputDirectory,
            "assets",
            "search.js"
        );

        const jsonData = JSON.stringify({
            rows,
            index,
        });

        writeFileSync(
            jsonFileName,
            `window.searchData = JSON.parse(${JSON.stringify(jsonData)});`
        );
    }

    private getCommentSearchText(reflection: DeclarationReflection) {
        if (!this.searchComments) return;

        const comments: Comment[] = [];
        if (reflection.comment) comments.push(reflection.comment);
        reflection.signatures?.forEach(
            (s) => s.comment && comments.push(s.comment)
        );
        reflection.getSignature?.comment &&
            comments.push(reflection.getSignature.comment);
        reflection.setSignature?.comment &&
            comments.push(reflection.setSignature.comment);

        if (!comments.length) {
            return;
        }

        return comments
            .flatMap((c) => {
                return [...c.summary, ...c.blockTags.flatMap((t) => t.content)];
            })
            .map((part) => part.text)
            .join("\n");
    }
}
