import { Component, Input, OnInit } from '@angular/core';
import { VocabularyNode } from '../../entities/node';
import { FilterOptions } from './filter-dropdown.component';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { Observable } from 'rxjs/Observable';
import { comparingLocalizable } from '../../utils/comparator';
import { LanguageService } from '../../services/language.service';
import { TranslateService } from 'ng2-translate';

@Component({
  selector: 'app-vocabulary-filter-dropdown',
  template: `
    <app-filter-dropdown class="pull-left"
                         [options]="vocabularyOptions"
                         [filterSubject]="filterSubject"></app-filter-dropdown>
  `
})
export class VocabularyFilterDropdownComponent implements OnInit {

  @Input() filterSubject: BehaviorSubject<VocabularyNode|null>;
  @Input() vocabularies: Observable<VocabularyNode[]>;

  vocabularyOptions: FilterOptions<VocabularyNode>;

  constructor(private languageService: LanguageService,
              private translateService: TranslateService) {
  }

  ngOnInit() {
    this.vocabularies.subscribe(vocabs => {

      vocabs.sort(comparingLocalizable<VocabularyNode>(this.languageService, org => org.label));

      this.vocabularyOptions = [
        { value: null, name: () => this.translateService.instant('All vocabularies') },
        ...vocabs.map(org => ({ value: org, name: () => this.languageService.translate(org.label, false)}))
      ];
    })
  }
}
