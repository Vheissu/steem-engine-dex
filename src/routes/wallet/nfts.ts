import { sleep } from 'common/functions';
import { checkTransaction } from 'common/steem-engine';
import { NftService } from './../../services/nft-service';
import { NftTransferModal } from './../../modals/nft/nft-transfer';
import { NftPropertiesModal } from './../../modals/nft/nft-properties';
import { DialogService } from 'aurelia-dialog';
import { State } from 'store/state';
import { connectTo, dispatchify } from 'aurelia-store';
import { SteemEngine } from 'services/steem-engine';
import { autoinject } from 'aurelia-framework';
import { getUserNfts, loading } from 'store/actions';

@autoinject()
@connectTo()
export class MyNfts {
    private state: State;
    private loading = false;
    private errors: string[] = [];
    
    constructor(private se: SteemEngine, private nftService: NftService, private dialogService: DialogService) {

    }

    async activate() {
        await dispatchify(getUserNfts)();
    }

    showNftProperties(token) {
        this.dialogService.open({ viewModel: NftPropertiesModal, model: token }).whenClosed(response => {
            //console.log(response);
        });
    }

    transferNft(token) {
        this.dialogService.open({ viewModel: NftTransferModal, model: token }).whenClosed(response => {

        });
    }

    async burnNft(token) {
        dispatchify(loading)(true);

        try {
            const transfer = await this.nftService.burn(token.symbol, token._id) as any;

            if (transfer.success) {
                try {
                    const verify = await checkTransaction(transfer.result.id, 3);
                    
                    if (verify?.errors) {
                        this.errors = verify.errors;
                    } else {
                        await sleep(3200);
                    }
                } catch (e) {
                    console.error(e);
                }
            }

            dispatchify(loading)(false);
        } catch {
            dispatchify(loading)(false);
        }
    }
}
