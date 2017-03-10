import { Component, Input, OnInit } from '@angular/core';
import { Node } from '../entities/node';
import { EditableService } from '../services/editable.service';
import { TermedService } from '../services/termed.service';

@Component({
  selector: 'vocabulary',
  styleUrls: ['./vocabulary.component.scss'],
  providers: [EditableService],
  template: `
    <ngb-accordion>
      <ngb-panel>
        <template ngbPanelTitle>
          <div class="main-panel-header">
            <h2>{{conceptScheme.label | translateValue}} <accordion-chevron></accordion-chevron></h2>
          </div>
        </template>
        <template ngbPanelContent>
          <div class="row">
            <div class="col-md-12">
              <form class="editable">
              
                <div class="row">
                  <div class="col-md-12">
                    <editable-buttons></editable-buttons>
                  </div>
                </div>
              
                <property [value]="property" *ngFor="let property of conceptScheme | properties"></property>
                <reference [value]="reference" *ngFor="let reference of conceptScheme | references"></reference>
                
                <dl class="row">
                  <dt class="col-md-3" translate>Id</dt>
                  <dd class="col-md-9">{{conceptScheme.uri}}</dd>
                </dl>
                
                <dl class="row">
                  <dt class="col-md-3" translate>Created at</dt>
                  <dd class="col-md-9">{{conceptScheme.createdDate | timestamp}}</dd>
                </dl>
                
                <dl class="row">
                  <dt class="col-md-3" translate>Modified at</dt>
                  <dd class="col-md-9">{{conceptScheme.lastModifiedDate | timestamp}}</dd>
                </dl>
              </form>
            </div>
          </div>
        </template>
      </ngb-panel>
    </ngb-accordion>
  `
})
export class VocabularyComponent implements OnInit {

  @Input('value') persistentConceptScheme: Node<'TerminologicalVocabulary'>;
  conceptScheme: Node<'TerminologicalVocabulary'>;

  constructor(editableService: EditableService, termedService: TermedService) {
    editableService.save$.subscribe(() => {
      termedService.updateNode(this.conceptScheme);
      this.persistentConceptScheme = this.conceptScheme;
    });

    editableService.cancel$.subscribe(() => {
      this.conceptScheme = this.persistentConceptScheme.clone();
    });
  }

  ngOnInit() {
    this.conceptScheme = this.persistentConceptScheme.clone();
  }
}
