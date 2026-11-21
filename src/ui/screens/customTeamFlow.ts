import type { ScreenId } from '../../contracts/ui';
import type { CustomTeam } from '../../data/customTeams';
import { customTeamStore } from '../customTeamStore';
import type { ListScreen } from './base';
import type { ScreenCtx } from './ctx';
import { CustomTeamEditor, type TeamEditResult } from './customTeamEditor';
import { CustomTeamList, type TeamListOptions } from './customTeamList';

/** What the host screen does with the flow's results (all optional). */
export interface TeamFlowHooks {
  /** A team was saved in the editor (`created`: a new team). */
  saved?(team: CustomTeam, created: boolean): void;
  /** A team was deleted (editor or list). */
  deleted?(team: CustomTeam): void;
  /** A team (or null = standard team) was picked in the list. */
  picked?(team: CustomTeam | null): void;
  /** Base car for a new team. */
  defaultBase?(): string;
  /** The team in use, marked in the list. */
  activeId?(): string | null;
  /** The flow closed (refresh the host). */
  closed?(): void;
  list?: Omit<TeamListOptions, 'activeId'>;
}

/** Embedded custom-team screens (list and editor) on top of a host screen's hidden stage. */
export class CustomTeamFlow {
  /** The open embedded screen; hosts forward key / action / render to it. */
  editor: ListScreen | null = null;
  constructor(private ctx: ScreenCtx, private id: ScreenId, private root: HTMLElement, private stage: HTMLElement, private hooks: TeamFlowHooks = {}) {
    customTeamStore();
  }
  /** Opens the editor: `existing` edits that team, otherwise a new team. `fromList` returns to the list afterwards. */
  open(existing?: CustomTeam, fromList = false): void {
    this.mount(new CustomTeamEditor(this.id, this.ctx, (r) => this.edited(r, fromList), existing, this.hooks.defaultBase?.()));
  }
  openList(): void {
    this.mount(new CustomTeamList(this.id, this.ctx, (r) => {
      switch (r.type) {
        case 'back': this.close(); break;
        case 'pick': this.dispose(); this.hooks.picked?.(r.team); this.hooks.closed?.(); break;
        case 'create': this.open(undefined, true); break;
        case 'edit': this.open(r.team, true); break;
        case 'deleted': this.hooks.deleted?.(r.team); this.openList(); break;
      }
    }, { ...this.hooks.list, activeId: this.hooks.activeId?.() ?? null }));
  }
  private edited(r: TeamEditResult, fromList: boolean): void {
    if (r.saved) this.hooks.saved?.(r.saved, !!r.created);
    if (r.deleted) this.hooks.deleted?.(r.deleted);
    if (fromList) this.openList(); else this.close();
  }
  private mount(screen: ListScreen): void {
    this.editor?.dispose();
    this.stage.hidden = true;
    this.stage.style.display = 'none';
    this.editor = screen;
    this.root.appendChild(screen.el);
    screen.enter(this.id);
  }
  private close(): void {
    this.dispose(); this.hooks.closed?.();
  }
  dispose(): void {
    this.editor?.dispose(); this.editor = null; this.stage.hidden = false; this.stage.style.display = '';
  }
}
