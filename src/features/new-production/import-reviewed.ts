import type { ArticleBody } from '../../domain/article.ts';
import { publicationMetadata } from '../../domain/publication.ts';
import { segmentRef } from '../../domain/refs.ts';
import type { EditorialPlan } from '../../domain/editorial-plan.ts';
import type { SourceAnalysis } from '../../ports/source-ingest.ts';
/** Preserve supplied text; approval remains a separate human action. */
export function importedArticle(title: string, analysis: SourceAnalysis, sourceId: string, editorial?: EditorialPlan): ArticleBody {
  const body: ArticleBody = { type: 'article', title, blocks: analysis.segments.map((segment, i) => ({
    id: `imported-${i + 1}`, type: 'paragraph', inlines: [{ text: segment.text }], sourceRefs: [segmentRef(sourceId, 1, segment.id)],
  })) };
  body.seo = publicationMetadata(body, editorial);
  return body;
}
