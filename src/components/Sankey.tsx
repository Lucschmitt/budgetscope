import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal, type SankeyNode, type SankeyLink } from 'd3-sankey';

// ── Types ──────────────────────────────────────────────────────────────────
interface Poste {
  id: string;
  label: string;
  valeur: number;
  couleur: string;
  fixe?: boolean;
}

interface SankeyProps {
  recettes: Array<Poste & { valeurEffective: number }>;
  depenses: Array<Poste & { valeurEffective: number }>;
  totalRecettes: number;
  totalDepenses: number;
}

interface NodeDatum {
  id: string;
  label: string;
  type: 'recette' | 'centre' | 'depense' | 'solde';
  valeur: number;
}

interface LinkDatum {
  source: string | number;
  target: string | number;
  value: number;
}

// ── Couleurs ───────────────────────────────────────────────────────────────
const COLORS: Record<string, string> = {
  recette: '#388bfd',
  centre:  '#8b949e',
  depense: '#f85149',
  surplus: '#3fb950',
  deficit: '#f85149',
};

function nodeColor(type: string) {
  return COLORS[type] ?? COLORS.centre;
}

// ── Composant ──────────────────────────────────────────────────────────────
export default function Sankey({ recettes, depenses, totalRecettes, totalDepenses }: SankeyProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const solde = totalRecettes - totalDepenses;

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const W = svgRef.current.clientWidth || 560;
    const H = 420;
    const margin = { top: 16, right: 140, bottom: 16, left: 140 };

    svg.attr('viewBox', `0 0 ${W} ${H}`);

    // ── Construire les nœuds et liens ────────────────────────────────────
    const nodes: NodeDatum[] = [
      // Recettes
      ...recettes.map(p => ({
        id: `r_${p.id}`,
        label: p.label,
        type: 'recette' as const,
        valeur: p.valeurEffective,
      })),
      // Nœud central "Budget"
      { id: 'budget', label: 'Budget', type: 'centre' as const, valeur: totalRecettes },
      // Dépenses
      ...depenses.map(p => ({
        id: `d_${p.id}`,
        label: p.label,
        type: 'depense' as const,
        valeur: p.valeurEffective,
      })),
      // Solde (surplus ou déficit)
      {
        id: 'solde',
        label: solde >= 0 ? 'Surplus' : 'Déficit',
        type: 'solde' as const,
        valeur: Math.abs(solde),
      },
    ];

    const links: LinkDatum[] = [
      // Recettes → Budget
      ...recettes.map(p => ({
        source: `r_${p.id}`,
        target: 'budget',
        value: Math.max(0.5, p.valeurEffective),
      })),
      // Budget → Dépenses
      ...depenses.map(p => ({
        source: 'budget',
        target: `d_${p.id}`,
        value: Math.max(0.5, p.valeurEffective),
      })),
      // Solde : surplus (budget → solde) ou déficit (solde ← budget fictif)
      ...(Math.abs(solde) > 0.5 ? [{
        source: solde >= 0 ? 'budget' : 'solde',
        target: solde >= 0 ? 'solde'  : 'budget',
        value: Math.abs(solde),
      }] : []),
    ];

    // Index nœuds par id
    const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));

    const sankeyLinks = links.map(l => ({
      source: nodeIndex.get(l.source as string) ?? 0,
      target: nodeIndex.get(l.target as string) ?? 0,
      value: l.value,
    }));

    // ── Layout Sankey ────────────────────────────────────────────────────
    const sankeyGen = sankey<NodeDatum, typeof sankeyLinks[0]>()
      .nodeId((_, i) => i)
      .nodeWidth(18)
      .nodePadding(10)
      .extent([[margin.left, margin.top], [W - margin.right, H - margin.bottom]]);

    const graph = sankeyGen({
      nodes: nodes.map(n => ({ ...n })),
      links: sankeyLinks,
    });

    const g = svg.append('g');

    // ── Dégradés pour les liens ──────────────────────────────────────────
    const defs = svg.append('defs');

    graph.links.forEach((link, i) => {
      const srcNode  = link.source as SankeyNode<NodeDatum, any>;
      const tgtNode  = link.target as SankeyNode<NodeDatum, any>;
      const srcType  = srcNode.type;
      const tgtType  = tgtNode.type;
      const srcColor = tgtType === 'solde' && solde < 0 ? COLORS.deficit
                     : srcType === 'recette' ? COLORS.recette
                     : tgtType === 'depense' ? COLORS.depense
                     : COLORS.centre;
      const tgtColor = tgtType === 'solde' ? (solde >= 0 ? COLORS.surplus : COLORS.deficit)
                     : tgtType === 'depense' ? COLORS.depense
                     : COLORS.recette;

      const grad = defs.append('linearGradient')
        .attr('id', `grad-${i}`)
        .attr('gradientUnits', 'userSpaceOnUse')
        .attr('x1', (srcNode.x1 ?? 0))
        .attr('x2', (tgtNode.x0 ?? 0));

      grad.append('stop').attr('offset', '0%').attr('stop-color', srcColor).attr('stop-opacity', 0.5);
      grad.append('stop').attr('offset', '100%').attr('stop-color', tgtColor).attr('stop-opacity', 0.5);
    });

    // ── Liens ────────────────────────────────────────────────────────────
    g.append('g')
      .selectAll('path')
      .data(graph.links)
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('fill', 'none')
      .attr('stroke', (_, i) => `url(#grad-${i})`)
      .attr('stroke-width', d => Math.max(1, d.width ?? 1))
      .attr('opacity', 0.7)
      .on('mouseover', function() { d3.select(this).attr('opacity', 1); })
      .on('mouseout',  function() { d3.select(this).attr('opacity', 0.7); });

    // ── Nœuds ────────────────────────────────────────────────────────────
    const nodeG = g.append('g')
      .selectAll('g')
      .data(graph.nodes)
      .join('g');

    nodeG.append('rect')
      .attr('x',      d => d.x0 ?? 0)
      .attr('y',      d => d.y0 ?? 0)
      .attr('width',  d => (d.x1 ?? 0) - (d.x0 ?? 0))
      .attr('height', d => Math.max(2, (d.y1 ?? 0) - (d.y0 ?? 0)))
      .attr('fill', d => {
        if (d.type === 'solde') return solde >= 0 ? COLORS.surplus : COLORS.deficit;
        return nodeColor(d.type);
      })
      .attr('rx', 3)
      .attr('opacity', 0.9);

    // ── Labels ───────────────────────────────────────────────────────────
    const FONT = '11px Inter, system-ui, sans-serif';

    nodeG.each(function(d) {
      const el    = d3.select(this);
      const x0    = d.x0 ?? 0;
      const x1    = d.x1 ?? 0;
      const yMid  = ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2;
      const isLeft   = d.type === 'recette';
      const isRight  = d.type === 'depense' || d.type === 'solde';
      const isCentre = d.type === 'centre';

      const labelX = isLeft   ? x0 - 6
                   : isRight  ? x1 + 6
                   : (x0 + x1) / 2;

      const anchor = isLeft   ? 'end'
                   : isRight  ? 'start'
                   : 'middle';

      // Nom du poste
      el.append('text')
        .attr('x', labelX)
        .attr('y', yMid - (isCentre ? 8 : 0))
        .attr('text-anchor', anchor)
        .attr('dominant-baseline', 'central')
        .attr('fill', '#c9d1d9')
        .attr('font', FONT)
        .text(d.label.length > 22 ? d.label.slice(0, 20) + '…' : d.label);

      // Valeur
      el.append('text')
        .attr('x', labelX)
        .attr('y', yMid + (isCentre ? 8 : 14))
        .attr('text-anchor', anchor)
        .attr('dominant-baseline', 'central')
        .attr('fill', '#8b949e')
        .attr('font', `500 ${FONT}`)
        .text(() => {
          if (d.type === 'solde') {
            return `${solde >= 0 ? '+' : '−'}${Math.abs(solde).toFixed(0)} mds`;
          }
          return `${d.valeur?.toFixed(0) ?? '?'} mds`;
        });
    });

  }, [recettes, depenses, totalRecettes, totalDepenses]);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: '420px' }}>
      <svg
        ref={svgRef}
        width="100%"
        height="420"
        style={{ display: 'block' }}
      />
    </div>
  );
}
