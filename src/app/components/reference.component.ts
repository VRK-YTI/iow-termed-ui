import { Component, Input } from '@angular/core';
import { Reference } from '../entities/node';
import { EditableService } from '../services/editable.service';
import { Node } from '../entities/node';

@Component({
  selector: 'reference',
  styleUrls: ['./reference.component.scss'],
  template: `
    <dl *ngIf="show">
      <dt><label [for]="reference.meta.id">{{reference.meta.label | translateValue}}</label></dt>
      <dd>
        <terms *ngIf="reference.term" [value]="reference" [multiColumn]="multiColumnTerms"></terms>
        
        <concept-reference-input *ngIf="!reference.term && reference.concept" [concept]="reference" [conceptsProvider]="conceptsProvider"></concept-reference-input>
        
        <div *ngIf="!reference.term && !reference.concept">
          <span *ngFor="let referenceNode of reference.values; let last = last">
            <span>{{referenceNode.label | translateValue}}<span *ngIf="!last">, </span></span>
          </span>
        </div>
      </dd>
    </dl>
  `
})
export class ReferenceComponent {

  @Input('value') reference: Reference;
  @Input() multiColumnTerms = false;
  @Input() conceptsProvider: () => Node<'Concept'>[];

  constructor(private editableService: EditableService) {
  }

  get show() {
    return this.editableService.editing || !this.reference.empty;
  }
}
