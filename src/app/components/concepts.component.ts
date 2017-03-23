import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConceptViewModelService } from '../services/concept.view.service';

@Component({
  selector: 'concepts',
  styleUrls: ['./concepts.component.scss'],
  providers: [ConceptViewModelService],
  template: `
    <div class="container-fluid">

      <ajax-loading-indicator *ngIf="loading"></ajax-loading-indicator>

      <div [hidden]="loading">

        <div class="row">
          <div class="col-12">
            <vocabulary></vocabulary>
          </div>
        </div>
  
        <div class="bottom">
        
          <div class="panel-left">
            <div float>
              <ngb-tabset>
                <ngb-tab>
                  <template ngbTabTitle>
                    <i class="fa fa-sort-alpha-asc"></i>
                    <p>{{'Alphabetic' | translate}}</p>
                  </template>
                  <template ngbTabContent><concept-list></concept-list></template>
                </ngb-tab>
                <ngb-tab>
                  <template ngbTabTitle>
                    <i class="fa fa-sitemap"></i>
                    <p>{{'Hierarchical' | translate}}</p>
                  </template>
                  <template ngbTabContent><concept-hierarchy></concept-hierarchy></template>
                </ngb-tab>
              </ngb-tabset>
            </div>
          </div>

          <div class="panel-right">
            <router-outlet></router-outlet>
          </div>

        </div>
      
      </div>
      
    </div>
  `
})
export class ConceptsComponent implements OnInit {

  constructor(private route: ActivatedRoute,
              private viewModel: ConceptViewModelService) {
  }

  get loading() {
    return this.viewModel.loadingConceptScheme || this.viewModel.loadingConcepts;
  }

  ngOnInit() {
    this.route.params.subscribe(params => {
      this.viewModel.initializeConceptScheme(params['graphId']);
    });
  }
}

