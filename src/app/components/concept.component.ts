import { Component, OnDestroy } from '@angular/core';
import { EditableService } from '../services/editable.service';
import { ConceptViewModelService } from '../services/concept.view.service';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

@Component({
  selector: 'concept',
  styleUrls: ['./concept.component.scss'],
  providers: [EditableService],
  template: `
    <div class="component" *ngIf="concept">
    
      <div class="component-header">
        <h3>{{persistentConcept.label | translateValue}}</h3>
      </div>
    
      <form class="component-content">
  
        <div class="row">
          <div class="col-md-12">
            <editable-buttons></editable-buttons>
          </div>
        </div>
  
        <concept-form [concept]="concept" [conceptsProvider]="conceptsProvider" [multiColumn]="true"></concept-form>
      </form>
      
    </div>
    
    <ajax-loading-indicator *ngIf="!concept"></ajax-loading-indicator>
  `
})
export class ConceptComponent implements OnDestroy {

  private subscriptionToClean: Subscription[] = [];

  constructor(private route: ActivatedRoute,
              private router: Router,
              private conceptViewModel: ConceptViewModelService,
              editableService: EditableService) {

    route.params.subscribe(params => conceptViewModel.initializeConcept(params['conceptId']));
    editableService.onSave = () => this.conceptViewModel.saveConcept();
    editableService.onCanceled = () => this.conceptViewModel.resetConcept();

    this.subscriptionToClean.push(this.conceptViewModel.concept$.subscribe(concept => {
      if (concept) {
        if (!concept.persistent && !editableService.editing) {
          editableService.edit();
        } else if (editableService.editing) {
          editableService.cancel();
        }
      }
    }));

    editableService.editing$.subscribe(editing => {
      if (!editing && this.conceptViewModel.concept && !this.conceptViewModel.concept.persistent) {
        this.router.navigate(['/concepts', this.conceptViewModel.graphId]);
      }
    });
  }

  ngOnDestroy() {
    for (const subscription of this.subscriptionToClean) {
      subscription.unsubscribe();
    }
  }

  get conceptsProvider() {
    return () => this.conceptViewModel.allConcepts$.getValue();
  }

  get concept() {
    return this.conceptViewModel.concept;
  }

  get persistentConcept() {
    return this.conceptViewModel.persistentConcept;
  }
}
